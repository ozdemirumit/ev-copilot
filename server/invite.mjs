// Davet üretir: node server/invite.mjs "Ali" [gün]  → tek kullanımlık davet linki yazar. Çalışan sunucuya yerel adresten bağlanır (yönetici kodu server/.env'den).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = {};
const file = join(here, '.env');
if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); }
const code = String(env.ACCESS_CODES || '').split(',')[0].trim();
if (!code) { console.error('server/.env içinde ACCESS_CODES yok.'); process.exit(1); }
const label = process.argv[2] || '';
const days = Number(process.argv[3]) || 7;
const res = await fetch(`http://127.0.0.1:${env.PORT || 8787}/admin/invites`, {
  method: 'POST', headers: { 'X-Access-Code': code, 'Content-Type': 'application/json' }, body: JSON.stringify({ label, days }),
}).catch((e) => { console.error('Sunucuya ulaşılamadı (çalışıyor mu?):', e.message); process.exit(1); });
if (!res.ok) { console.error('Hata:', res.status, await res.text()); process.exit(1); }
const j = await res.json();
console.log(`Davet (${label || 'adsız'}, ${days} gün, tek kullanımlık):\n${j.link || j.code}`);
