// POST /v1/map/choice (Premium kullanıcı kendi harita sağlayıcısını seçer) testleri (bağımsız, düz node): node scripts/test-map-choice.mjs
// Kurallar: yalnızca hesaplı + Premium kullanıcı; yalnızca anahtarı tanımlı sağlayıcı (osm hep); seçim u.mapProvider'a yazılır (yönetici seçimiyle aynı alan);
// null = varsayılanı izle; yanıtta anahtar yok; üst sunucu (ücretli) çağrısı yok. Sunucu ayrı alt süreç, 18881-18882 portlarında, geçici DATA_DIR ve YALNIZCA SAHTE anahtarlarla.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CODE = 'test-dummy-access-code-0123456789';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const TOK_FREE = 'F'.repeat(30), TOK_PREM = 'P'.repeat(30), TOK_PREM2 = 'Q'.repeat(30);
const FAKE = { MAPBOX_MAP_TOKEN: 'pk.SAHTE-mapbox-harita-111', MAPBOX_TOKEN: 'sahte-mapbox-sunucu-222', TOMTOM_KEY: 'sahte-tomtom-sunucu-333', TOMTOM_MAP_KEY: 'sahte-tomtom-harita-444', GOOGLE_MAPS_BROWSER_KEY: 'sahte-google-harita-555' };
const BLANK = Object.fromEntries(['MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'OCM_KEY', 'HERE_API_KEY', 'HERE_MAP_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'VERIAPI_KEY'].map((k) => [k, '']));

let upstreamHits = 0;
const upstream = http.createServer((req, res) => { upstreamHits++; res.writeHead(500); res.end('{}'); });
await new Promise((r) => upstream.listen(18880, '127.0.0.1', r));
const UP = 'http://127.0.0.1:18880';

const seed = () => {
  const now = Date.now();
  return {
    users: {
      u_free: { id: 'u_free', email: 'free@test.invalid', name: 'FreeKisi', createdAt: now },
      u_prem: { id: 'u_prem', email: 'prem@test.invalid', name: 'PremKisi', createdAt: now, premiumUntil: now + 30 * 86400e3 },
      u_prem2: { id: 'u_prem2', email: 'prem2@test.invalid', name: 'PremKisi2', createdAt: now, premiumUntil: now + 30 * 86400e3 },
    },
    invites: {}, docs: {},
    sessions: {
      [sha256(TOK_FREE)]: { uid: 'u_free', createdAt: now, lastSeen: now, exp: now + 86400e3 },
      [sha256(TOK_PREM)]: { uid: 'u_prem', createdAt: now, lastSeen: now, exp: now + 86400e3 },
      [sha256(TOK_PREM2)]: { uid: 'u_prem2', createdAt: now, lastSeen: now, exp: now + 86400e3 },
    },
  };
};

const children = [], dirs = [];
async function start(port, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mapchoice-test-')); dirs.push(dir);
  writeFileSync(join(dir, 'db.json'), JSON.stringify(seed()));
  writeFileSync(join(dir, 'tesla.json'), JSON.stringify({ at: Date.now(), sites: [] }));
  const child = spawn(process.execPath, ['server/proxy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...BLANK, PROVIDER_REQUESTS_PAUSED: '0', PREMIUM_REQUIRED: '1', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE,
      MAPBOX_BASE: UP, OCM_BASE: UP, TOMTOM_BASE: UP, HERE_BASE: UP, HERE_ROUTER_BASE: UP, OVERPASS_URLS: UP, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out);
  const call = async (method, path, { auth, body } = {}) => {
    const headers = {};
    if (auth === 'code') headers['X-Access-Code'] = CODE; else if (auth) headers.Authorization = 'Bearer ' + auth;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, text, json: j };
  };
  return { call, dir };
}
const stored = async (dir, uid) => { await new Promise((r) => setTimeout(r, 1100)); return storedNow(dir, uid); }; // store.save 800 ms ertelemeli yazar
const storedNow = (dir, uid) => JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')).users[uid]?.mapProvider ?? null;
const choose = (S, auth, provider) => S.call('POST', '/v1/map/choice', { auth, body: { provider } });
const noLeak = (text) => !Object.values(FAKE).some((v) => text.includes(v)) && !/pk\.|test\.invalid|u_prem|PremKisi/.test(text);

try {
  // ---- A: tüm sahte harita anahtarları var ----
  {
    const A = await start(18881, FAKE);
    let r = await choose(A, undefined, 'mapbox');
    ok('A kimliksiz → 401', r.status === 401);
    r = await choose(A, TOK_FREE, 'mapbox');
    ok('A Free → 402 premium_required', r.status === 402 && r.json?.error === 'premium_required');
    ok('A Free: seçim yazılmadı', await stored(A.dir, 'u_free') === null);
    r = await choose(A, 'code', 'mapbox');
    ok('A hesapsız erişim kodu → 403 (hesap gerekir)', r.status === 403);

    r = await choose(A, TOK_PREM, 'mapbox');
    ok('A Premium mapbox → 200 ok, seçim mapbox, etkin mapbox', r.status === 200 && r.json?.ok === true && r.json?.choice === 'mapbox' && r.json?.effective === 'mapbox');
    ok('A yanıtta anahtar/kullanıcı sızıntısı yok', noLeak(r.text));
    ok('A seçim u.mapProvider alanına kalıcı yazıldı', await stored(A.dir, 'u_prem') === 'mapbox');
    r = await A.call('GET', '/v1/providers', { auth: TOK_PREM });
    ok('A /v1/providers seçili harita artık mapbox', r.json?.selected?.map === 'mapbox');
    r = await A.call('GET', '/v1/map/config', { auth: TOK_PREM });
    ok('A /v1/map/config seçilen sağlayıcıyı verir (mapbox)', r.json?.provider === 'mapbox');
    r = await A.call('GET', '/v1/providers', { auth: TOK_PREM2 });
    ok('A başka kullanıcı etkilenmez (varsayılan tomtom)', r.json?.selected?.map === 'tomtom' && await stored(A.dir, 'u_prem2') === null);

    for (const p of ['google', 'tomtom', 'osm']) {
      r = await choose(A, TOK_PREM, p);
      ok(`A ${p} seçilebilir`, r.status === 200 && r.json?.choice === p && r.json?.effective === p);
    }
    r = await choose(A, TOK_PREM, null);
    ok('A null: seçim kalkar, varsayılanı izler (tomtom)', r.status === 200 && r.json?.choice === null && r.json?.effective === 'tomtom' && await stored(A.dir, 'u_prem') === null);
    await choose(A, TOK_PREM, 'mapbox'); // geçersiz girdilerin ÖNCEKİ seçimi bozmadığını ölçebilmek için

    r = await choose(A, TOK_PREM, 'bing');
    ok('A geçersiz ad → 400, seçim değişmedi (mapbox)', r.status === 400 && await stored(A.dir, 'u_prem') === 'mapbox');
    r = await choose(A, TOK_PREM, 'here');
    ok('A here (HERE_MAP_KEY yok) → 400', r.status === 400);
    r = await A.call('POST', '/v1/map/choice', { auth: TOK_PREM, body: {} });
    ok('A provider alanı yok → 400', r.status === 400);
    r = await A.call('POST', '/v1/map/choice', { auth: TOK_PREM, body: { provider: ['mapbox'] } });
    ok('A dizi/nesne değer → 400, seçim değişmedi (mapbox)', r.status === 400 && await stored(A.dir, 'u_prem') === 'mapbox');
    r = await A.call('GET', '/v1/map/choice', { auth: TOK_PREM });
    ok('A GET /v1/map/choice yok (yalnızca POST)', r.status !== 200);
  }

  // ---- B: yalnızca Mapbox harita anahtarı var ----
  {
    const B = await start(18882, { MAPBOX_MAP_TOKEN: FAKE.MAPBOX_MAP_TOKEN });
    let r = await choose(B, TOK_PREM, 'google');
    ok('B anahtarı olmayan google → 400 anahtar yok, seçim yazılmadı', r.status === 400 && /anahtar/.test(r.json?.error || '') && await stored(B.dir, 'u_prem') === null);
    r = await choose(B, TOK_PREM, 'tomtom');
    ok('B anahtarı olmayan tomtom → 400', r.status === 400 && await stored(B.dir, 'u_prem') === null);
    r = await choose(B, TOK_PREM, 'osm');
    ok('B osm her zaman seçilebilir', r.status === 200 && r.json?.effective === 'osm');
    r = await choose(B, TOK_PREM, 'mapbox');
    ok('B mapbox seçilebilir', r.status === 200 && r.json?.effective === 'mapbox');
  }

  ok('hiçbir üst sunucu (ücretli) çağrısı yapılmadı', upstreamHits === 0);
} catch (e) {
  ok('beklenmeyen hata: ' + (e?.message || e), false);
} finally {
  for (const c of children) c.kill();
  upstream.close();
  await new Promise((r) => setTimeout(r, 200));
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
