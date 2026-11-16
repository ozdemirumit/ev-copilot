// G2a sunucu kota boşlukları Q-SRV-1/2/3: node scripts/test-server-quota.mjs
// Deterministik, çevrimdışı. Gerçek anahtar yok (yalnız sahte değerler), gerçek sağlayıcıya istek yok:
//   A) saf modül server/quotaCounters.mjs (aylık sınır ayrıştırma, kalıcı günlük kullanıcı sayacı; sahte saat + sahte depo)
//   B) sunucu: server/proxy.mjs ayrı alt süreçte, 8787 DIŞINDA bir portta (18891-18899), geçici DATA_DIR; MAPBOX_BASE / HERE_BASE
//      yerel sahte üst sunucuya (18890) yönlendirilir ve gelen her istek sayılır. Yeniden başlatma = süreci öldürüp AYNI DATA_DIR ile açmak.
//   C) statik sıra denetimi: aylık sınır günlük hak harcanmadan ÖNCE
// Kota DEĞERİ uydurulmaz: testteki sınırlar (1, 2, 4799) yalnız davranışı sınamak içindir; varsayılanlar kaynaktakiyle aynı kalır.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };

const realFetch = globalThis.fetch; // yalnız 127.0.0.1 test sunucusuna (B bölümü)
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };

// =====================================================================================================================
// A) Saf modül
// =====================================================================================================================
let Q = null;
try { Q = await import('../server/quotaCounters.mjs'); } catch (e) { ok('server/quotaCounters.mjs yüklenir', false, e.message); }
if (Q) {
  const { parseMonthlyCap, createDailyUsage } = Q;
  // Q-SRV-2: boş → kaynaktaki varsayılan (politika korunur), rakam → o sınır, başka her değer → 0 (fail-closed)
  ok('parseMonthlyCap: tanımsız/boş/boşluk → varsayılan, geçerli', ['', '  ', undefined, null].every((v) => { const r = parseMonthlyCap(v, 4800); return r.cap === 4800 && r.valid === true; }));
  ok('parseMonthlyCap: tam sayı → o sınır (boşluk kırpılır)', parseMonthlyCap('5000', 4800).cap === 5000 && parseMonthlyCap(' 12 ', 20000).cap === 12 && parseMonthlyCap('5000', 4800).valid === true);
  ok('parseMonthlyCap: "0" → 0 (hiç istek yok), geçerli', parseMonthlyCap('0', 4800).cap === 0 && parseMonthlyCap('0', 4800).valid === true);
  ok('parseMonthlyCap: geçersiz (abc, -5, 1.5, 1e3, NaN, 12abc, Infinity) → 0, geçersiz (fail-closed)', ['abc', '-5', '1.5', '1e3', 'NaN', '12abc', 'Infinity'].every((v) => { const r = parseMonthlyCap(v, 4800); return r.cap === 0 && r.valid === false; }));
  ok('parseMonthlyCap: geçersiz değerde sınır NaN değil (n >= cap her zaman true)', [0, 1, 999].every((n) => n >= parseMonthlyCap('abc', 4800).cap));

  // Q-SRV-3: günlük sayaç depo verisinde (db.json) tutulur; gün (UTC) değişince sıfırlanır
  let t = Date.parse('2026-11-16T23:59:59.000Z');
  const now = () => t;
  let saves = 0;
  const fakeStore = { data: {}, save: () => { saves++; } };
  const du = createDailyUsage(fakeStore, { now });
  ok('günlük sayaç: başlangıçta 0', du.get('u1', 'mapbox') === 0);
  ok('günlük sayaç: add → 1, 2 ve her artış depoya kaydettirilir (save)', du.add('u1', 'mapbox') === 1 && du.add('u1', 'mapbox') === 2 && saves === 2, String(saves));
  ok('günlük sayaç: kullanıcı ve tür ayrı', du.get('u2', 'mapbox') === 0 && du.get('u1', 'here') === 0);
  ok('günlük sayaç depo verisinde (store.data.dailyUsage) gün ile', fakeStore.data.dailyUsage?.day === '2026-11-16' && fakeStore.data.dailyUsage?.counts?.['u1|mapbox'] === 2, JSON.stringify(fakeStore.data.dailyUsage));
  const du2 = createDailyUsage({ data: JSON.parse(JSON.stringify(fakeStore.data)), save() {} }, { now });
  ok('yeniden başlatma benzetimi: diskten okunan veriyle yeni örnek aynı sayıyı görür', du2.get('u1', 'mapbox') === 2);
  ok('entries(): bugünkü [anahtar, tür, sayı]', JSON.stringify(du.entries()) === JSON.stringify([['u1', 'mapbox', 2]]), JSON.stringify(du.entries()));
  t = Date.parse('2026-11-16T23:59:59.999Z');
  ok('gün sınırı: 23:59:59.999Z hâlâ aynı gün', du.get('u1', 'mapbox') === 2);
  t = Date.parse('2026-11-17T00:00:00.000Z');
  ok('gün sınırı: 00:00:00.000Z yeni gün → 0 (dünkü sayılmaz)', du.get('u1', 'mapbox') === 0 && du.entries().length === 0);
  ok('yeni günde add → 1 ve eski gün verisi silinir', du.add('u1', 'mapbox') === 1 && fakeStore.data.dailyUsage.day === '2026-11-17' && Object.keys(fakeStore.data.dailyUsage.counts).length === 1);
  for (const bad of ['garbage', null, [], { day: '2026-11-17', counts: 'x' }, { day: '2026-11-17', counts: [] }, { day: '2026-11-17', counts: { 'u1|mapbox': 'çok' } }, { day: '2026-11-17', counts: { 'u1|mapbox': -3 } }]) {
    let threw = false, v = null;
    try { v = createDailyUsage({ data: { dailyUsage: bad }, save() {} }, { now }).get('u1', 'mapbox'); } catch { threw = true; }
    ok(`bozuk kayıt (${JSON.stringify(bad)}) → atmaz, 0`, !threw && v === 0, String(v));
  }
  ok('geçerli bugünkü kayıt okunur (2)', createDailyUsage({ data: { dailyUsage: { day: '2026-11-17', counts: { 'u1|x': 2 } } }, save() {} }, { now }).get('u1', 'x') === 2);
  ok('anahtarında | olan kullanıcı entries()\'te doğru ayrılır (son | türü ayırır)', (() => { const d = createDailyUsage({ data: {}, save() {} }, { now }); d.add('a|b', 'ocm'); return JSON.stringify(d.entries()) === JSON.stringify([['a|b', 'ocm', 1]]); })());
}

// =====================================================================================================================
// B) Sunucu (server/proxy.mjs alt süreç)
// =====================================================================================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CODE = 'test-dummy-access-code-0123456789'; // sahte eski yönetici erişim kodu (>=16 karakter)
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const TOK_FREE = 'F'.repeat(30), TOK_PREM = 'P'.repeat(30);
const FAKE_MB = 'sahte-mapbox-sunucu-anahtari-918', FAKE_HERE = 'sahte-here-sunucu-anahtari-918';
const BAD_CAP = 'zz9q'; // geçersiz sınır değeri: günlüğe yazılmamalı
const BLANK = Object.fromEntries(['MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'VERIAPI_KEY', 'MAPBOX_DAILY_PER_USER', 'MAPBOX_MONTHLY_CAP', 'MAPBOX_MONTH_USED_SEED', 'MAPBOX_ROUTE_MONTHLY_CAP', 'MAPBOX_ROUTE_PREMIUM_ONLY', 'HERE_DAILY_PER_USER', 'HERE_MONTHLY_CAP', 'SPEEDLIMIT_DAILY_PER_USER'].map((k) => [k, '']));

const up = { hits: [] };
const upstream = http.createServer((req, res) => {
  up.hits.push(req.url);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'Ok', routes: [], features: [], items: [] }));
});
await new Promise((r) => upstream.listen(18890, '127.0.0.1', r));
const UP = 'http://127.0.0.1:18890';
const searchHits = () => up.hits.filter((u) => u.startsWith('/search/')).length;
const hereHits = () => up.hits.filter((u) => u.startsWith('/v1/browse')).length;

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
const ym = new Date().toISOString().slice(0, 7);
const seed = (extra = {}) => {
  const now = Date.now();
  return {
    users: {
      u_free: { id: 'u_free', email: 'free@test.invalid', name: 'FreeKisi', createdAt: now },
      u_prem: { id: 'u_prem', email: 'prem@test.invalid', name: 'PremKisi', createdAt: now, premiumUntil: now + 30 * 86400e3 },
    },
    invites: {}, docs: {},
    sessions: {
      [sha256(TOK_FREE)]: { uid: 'u_free', createdAt: now, lastSeen: now, exp: now + 86400e3 },
      [sha256(TOK_PREM)]: { uid: 'u_prem', createdAt: now, lastSeen: now, exp: now + 86400e3 },
    },
    ...extra,
  };
};
const children = [], dirs = [];
const newDir = (extra) => { const dir = mkdtempSync(join(tmpdir(), 'srvquota-test-')); dirs.push(dir); writeFileSync(join(dir, 'db.json'), JSON.stringify(seed(extra))); writeFileSync(join(dir, 'tesla.json'), JSON.stringify({ at: Date.now(), sites: [] })); return dir; };
async function start(port, extra = {}, dir = newDir()) {
  const child = spawn(process.execPath, ['server/proxy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...BLANK, PROVIDER_REQUESTS_PAUSED: '0', PREMIUM_REQUIRED: '1', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE,
      MAPBOX_TOKEN: FAKE_MB, MAPBOX_BASE: UP, OCM_BASE: UP, TOMTOM_BASE: UP, HERE_BASE: UP, HERE_ROUTER_BASE: UP, OVERPASS_URLS: UP, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out);
  const call = async (path, auth) => {
    const headers = { 'X-Device-Id': 'd_testtesttesttesttest' };
    if (auth === 'code') headers['X-Access-Code'] = CODE; else if (auth) headers.Authorization = 'Bearer ' + auth;
    const r = await realFetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, text, json: j };
  };
  // store.save() 800 ms gecikmeli yazar (server/store.mjs): okumadan / öldürmeden önce bekle
  const settle = () => new Promise((r) => setTimeout(r, 1300));
  const db = async () => { await settle(); return JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')); };
  const daily = async (key, kind) => { const d = (await db()).dailyUsage; return d?.day === today ? d.counts?.[`${key}|${kind}`] ?? 0 : 0; };
  const usageOf = async (who, kind) => { const s = await call('/admin/summary', 'code'); return (s.json?.usageByUser || []).find((r) => r.id === who)?.kinds?.[kind] ?? 0; };
  // Windows'ta kill() süreci sinyal işleyicisi olmadan sonlandırır (çökme gibi): kalıcılık gecikmeli kayda dayanır
  const stop = async () => { await settle(); child.kill(); await new Promise((r) => child.exitCode !== null ? r() : child.once('exit', r)); };
  return { call, db, daily, usageOf, stop, dir, log: () => out };
}
const SEARCH = (n) => `/mapbox/search/searchbox/v1/category/ev_charging_station?proximity=29.${n},41`; // her n ayrı önbellek anahtarı
const HERE_ST = (n) => `/here/stations?lat=41.0${n}&lon=29.0${n}&r=10`;

try {
  // ---- B1) Q-SRV-1 sınır: günlük hak 2 → 1., 2. geçer; 3.–5. 429 ve sayaç 2'de kalır ----
  let dirB1 = null;
  {
    const s = await start(18891, { MAPBOX_DAILY_PER_USER: '2' });
    dirB1 = s.dir;
    const h0 = searchHits();
    const r = [];
    for (let i = 1; i <= 5; i++) r.push((await s.call(SEARCH(i), TOK_FREE)).status);
    ok('Q-SRV-1 sınır: hak 2 → 200, 200, 429, 429, 429', JSON.stringify(r) === '[200,200,429,429,429]', JSON.stringify(r));
    ok('Q-SRV-1: üst sunucuya yalnız 2 istek gitti', searchHits() - h0 === 2, String(searchHits() - h0));
    ok('Q-SRV-1: reddedilen 3 istek günlük sayacı artırmadı (yönetim özeti = 2)', await s.usageOf('u_free', 'mapbox') === 2, String(await s.usageOf('u_free', 'mapbox')));
    ok('Q-SRV-3: günlük sayaç db.json\'a yazıldı (u_free|mapbox = 2, bugün)', await s.daily('u_free', 'mapbox') === 2, String(await s.daily('u_free', 'mapbox')));
    const prem = await s.call(SEARCH(6), TOK_PREM);
    ok('kullanıcı başına ayrı: başka hesap etkilenmez (200)', prem.status === 200, String(prem.status));
    const codes = [];
    for (let i = 7; i <= 9; i++) codes.push((await s.call(SEARCH(i), 'code')).status);
    ok('yönetici erişim kodu sınırsız (3 × 200) ama sayılır (code = 3)', JSON.stringify(codes) === '[200,200,200]' && await s.usageOf('code', 'mapbox') === 3, JSON.stringify(codes));
    await s.stop();
  }
  // ---- B1r) Q-SRV-3 yeniden başlatma: aynı DATA_DIR → hak hâlâ dolu, üst sunucuya gitmez ----
  {
    const s = await start(18892, { MAPBOX_DAILY_PER_USER: '2' }, dirB1);
    const h0 = searchHits();
    const a = await s.call(SEARCH(10), TOK_FREE);
    ok('Q-SRV-3: yeniden başlatmadan sonra günlük hak hâlâ dolu → 429', a.status === 429, `${a.status} ${a.text}`);
    ok('Q-SRV-3: yeniden başlatma sonrası ret üst sunucuya gitmedi', searchHits() === h0);
    ok('Q-SRV-3: yeniden başlatma sonrası sayaç 2 (ret sayılmadı), yönetim özetinde görünür', await s.usageOf('u_free', 'mapbox') === 2 && await s.daily('u_free', 'mapbox') === 2);
    ok('Q-SRV-3: diğer hesabın sayacı da korundu (u_prem = 1, code = 3)', await s.daily('u_prem', 'mapbox') === 1 && await s.daily('code', 'mapbox') === 3);
    await s.stop();
  }
  // ---- B1h) hak artırılarak yeniden başlatma: kalıcı sayaç yeni sınıra göre değerlendirilir (3. istek geçer, 4. 429) ----
  {
    const s = await start(18893, { MAPBOX_DAILY_PER_USER: '3' }, dirB1);
    const r = [(await s.call(SEARCH(11), TOK_FREE)).status, (await s.call(SEARCH(12), TOK_FREE)).status];
    ok('sınır 3 ile yeniden başlatma: sayaç 2 → bir istek daha geçer, sonra 429', JSON.stringify(r) === '[200,429]', JSON.stringify(r));
    await s.stop();
  }
  // ---- B2) gün sınırı ve bozuk kayıt: dünkü sayaç sayılmaz; bugünkü dolu sayaç açılışta geçerli; bozuk kayıt sunucuyu düşürmez ----
  {
    const s = await start(18894, { MAPBOX_DAILY_PER_USER: '2' }, newDir({ dailyUsage: { day: yesterday, counts: { 'u_free|mapbox': 99 } } }));
    const a = await s.call(SEARCH(13), TOK_FREE);
    ok('gün sınırı: dünkü (99) sayaç bugün sayılmaz → 200', a.status === 200, `${a.status} ${a.text}`);
    const d = (await s.db()).dailyUsage;
    ok('gün sınırı: yeni günde dünkü kayıt atılır (yalnız bugün, u_free|mapbox = 1)', d?.day === today && JSON.stringify(d.counts) === JSON.stringify({ 'u_free|mapbox': 1 }), JSON.stringify(d));
    await s.stop();
  }
  {
    const s = await start(18895, { MAPBOX_DAILY_PER_USER: '2' }, newDir({ dailyUsage: { day: today, counts: { 'u_free|mapbox': 2 } } }));
    const h0 = searchHits();
    const a = await s.call(SEARCH(14), TOK_FREE);
    ok('açılışta diskteki bugünkü dolu sayaç geçerli → ilk istek 429, üst sunucuya gitmez', a.status === 429 && searchHits() === h0, `${a.status}`);
    await s.stop();
  }
  {
    const s = await start(18896, { MAPBOX_DAILY_PER_USER: '2' }, newDir({ dailyUsage: 'bozuk' }));
    const a = await s.call(SEARCH(15), TOK_FREE);
    ok('bozuk dailyUsage kaydı sunucuyu düşürmez; sayaç baştan başlar (200, sonra kayıt düzelir)', a.status === 200 && await s.daily('u_free', 'mapbox') === 1, `${a.status}`);
    await s.stop();
  }
  // ---- B3) Q-SRV-1 aylık sınıra takılan istek günlük hakkı harcamaz; Q-SRV-2 geçersiz / varsayılan / 0 ----
  {
    const s = await start(18897, { MAPBOX_DAILY_PER_USER: '5', MAPBOX_MONTHLY_CAP: '1' });
    const h0 = searchHits();
    const r = [];
    for (let i = 16; i <= 18; i++) { const x = await s.call(SEARCH(i), TOK_FREE); r.push(x.status + (x.json?.error === 'mapbox_cap' ? ':cap' : '')); }
    ok('Mapbox aylık sınır 1: 200, sonra 402 mapbox_cap ×2', JSON.stringify(r) === '["200","402:cap","402:cap"]', JSON.stringify(r));
    ok('aylık sınır reddi üst sunucuya gitmedi (yalnız 1 istek)', searchHits() - h0 === 1, String(searchHits() - h0));
    ok('Q-SRV-1: aylık sınır reddi günlük hakkı harcamadı (u_free|mapbox = 1)', await s.daily('u_free', 'mapbox') === 1 && await s.usageOf('u_free', 'mapbox') === 1, String(await s.daily('u_free', 'mapbox')));
    await s.stop();
  }
  {
    const s = await start(18898, { MAPBOX_DAILY_PER_USER: '5', MAPBOX_MONTHLY_CAP: BAD_CAP, HERE_API_KEY: FAKE_HERE, HERE_MONTHLY_CAP: BAD_CAP });
    const h0 = searchHits(), hh0 = hereHits();
    const a = await s.call(SEARCH(19), TOK_FREE);
    ok('Q-SRV-2: geçersiz MAPBOX_MONTHLY_CAP → 402 mapbox_cap (fail-closed), üst sunucuya gitmez', a.status === 402 && a.json?.error === 'mapbox_cap' && searchHits() === h0, `${a.status} ${a.text}`);
    const hres = await s.call(HERE_ST(1), TOK_FREE);
    ok('Q-SRV-2: geçersiz HERE_MONTHLY_CAP → 402 here_cap (fail-closed), üst sunucuya gitmez', hres.status === 402 && hres.json?.error === 'here_cap' && hereHits() === hh0, `${hres.status} ${hres.text}`);
    ok('Q-SRV-1: sınır reddi günlük hakları harcamadı (mapbox 0, here 0)', await s.daily('u_free', 'mapbox') === 0 && await s.daily('u_free', 'here') === 0);
    const log = s.log();
    ok('Q-SRV-2: geçersiz sınır uyarısı günlükte (ad var, değer yok)', /MAPBOX_MONTHLY_CAP/.test(log) && /HERE_MONTHLY_CAP/.test(log) && !log.includes(BAD_CAP), log.slice(0, 400));
    ok('sahte anahtarlar yanıtta ve günlükte yok', ![a, hres].some((x) => x.text.includes(FAKE_MB) || x.text.includes(FAKE_HERE)) && !log.includes(FAKE_MB) && !log.includes(FAKE_HERE));
    await s.stop();
  }
  {
    // boş sınır → kaynaktaki varsayılan (Mapbox 4800) korunur: ayın sayacı 4799'dan başlar → 1 istek geçer, sonra 402
    const s = await start(18899, { MAPBOX_DAILY_PER_USER: '5', MAPBOX_MONTH_USED_SEED: `${ym}:4799`, HERE_API_KEY: FAKE_HERE, HERE_MONTHLY_CAP: '1' });
    const r = [(await s.call(SEARCH(20), TOK_FREE)).status, (await s.call(SEARCH(21), TOK_FREE)).status];
    ok('Q-SRV-2: MAPBOX_MONTHLY_CAP boş → varsayılan 4800 korunur (4799 → 200, 4800 → 402)', JSON.stringify(r) === '[200,402]', JSON.stringify(r));
    const hh0 = hereHits();
    const hr = [];
    for (let i = 2; i <= 4; i++) { const x = await s.call(HERE_ST(i), TOK_FREE); hr.push(x.status + (x.json?.error === 'here_cap' ? ':cap' : '')); }
    ok('HERE aylık sınır 1: 200, sonra 402 here_cap ×2, üst sunucuya 1 istek', JSON.stringify(hr) === '["200","402:cap","402:cap"]' && hereHits() - hh0 === 1, `${JSON.stringify(hr)} ${hereHits() - hh0}`);
    ok('Q-SRV-1: HERE aylık sınır reddi günlük HERE hakkını harcamadı (u_free|here = 1)', await s.daily('u_free', 'here') === 1, String(await s.daily('u_free', 'here')));
    ok('geçerli yapılandırmada sınır uyarısı yok', !/MONTHLY_CAP geçersiz/.test(s.log()));
    await s.stop();
  }
  {
    const s = await start(18891, { MAPBOX_MONTHLY_CAP: '0', HERE_API_KEY: FAKE_HERE, HERE_MONTHLY_CAP: '0' });
    const h0 = searchHits(), hh0 = hereHits();
    const a = await s.call(SEARCH(22), TOK_FREE), b = await s.call(HERE_ST(5), TOK_FREE);
    ok('Q-SRV-2: sınır "0" → hiç istek yok (402; eskiden 0 || 4800 = 4800 idi)', a.status === 402 && b.status === 402 && searchHits() === h0 && hereHits() === hh0, `${a.status} ${b.status}`);
    await s.stop();
  }
} catch (e) {
  ok('B bölümü hatasız tamamlandı', false, e.stack || e.message);
} finally {
  for (const c of children) if (c.exitCode === null) c.kill();
  upstream.close();
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows kilidi */ } }
}

// =====================================================================================================================
// C) Statik sıra: aylık sınır denetimi günlük hak (overQuota) harcanmadan ÖNCE; overQuota reddi saymaz
// =====================================================================================================================
const PROXY = readFileSync(join(ROOT, 'server/proxy.mjs'), 'utf8');
const body = (name) => { const i = PROXY.indexOf(`function ${name}(`); return i < 0 ? '' : PROXY.slice(i, PROXY.indexOf('\n}', i)); };
const before = (b, a, c) => b.indexOf(a) > 0 && b.indexOf(c) > b.indexOf(a);
ok('mapbox(): aramada aylık sınır (MB_CAP) günlük haktan önce', before(body('mapbox'), 'mbUsage().n >= MB_CAP', "overQuota(id, 'mapbox')"));
ok('hereStations(): hereAllowed() günlük haktan önce', before(body('hereStations'), 'hereAllowed()', "overQuota(id, 'here')"));
ok('speedLimitsRoute(): hereAllowed() günlük haktan önce', before(body('speedLimitsRoute'), 'hereAllowed()', "overQuota(id, 'slimit')"));
ok('tomtomRouteRoute(): günlük tavan günlük haktan önce (değişmedi)', before(body('tomtomRouteRoute'), 'tomtomAllowed()', "overQuota(id, 'tomtom')"));
ok('aylık sınırlar parseMonthlyCap ile (geçersiz → 0)', /const MB_CAP_CFG = parseMonthlyCap\(env\.MAPBOX_MONTHLY_CAP, 4800\);/.test(PROXY) && /const HERE_CAP_CFG = parseMonthlyCap\(env\.HERE_MONTHLY_CAP, 20000\);/.test(PROXY));
ok('günlük sayaç bellekte değil (usage Map yok), kalıcı createDailyUsage(store)', !/const usage = new Map\(\)/.test(PROXY) && /createDailyUsage\(store\)/.test(PROXY));

ok('A/C bölümlerinde gerçek ağ çağrısı yok', netCalls === 0, String(netCalls));
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
