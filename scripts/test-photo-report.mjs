// İstasyon fotoğrafı bildirme / gizleme / yönetici inceleme testi. (a) server/stationinfo.mjs saf mantığı (sahte depo, geçici klasör);
// (b) alt süreç sunucu (18840, 8787 DIŞI, geçici DATA_DIR, sahte anahtar yok) üzerinden uçtan uca; (c) istemci ve yönetim sayfası içerik denetimi.
// Kullanım: node scripts/test-photo-report.mjs
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const jpeg = (n = 1500) => { const b = Buffer.alloc(n, 7); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[n - 2] = 0xff; b[n - 1] = 0xd9; return b; };
const dirs = [];
const children = [];

// ---- (a) stationinfo.mjs ----
try {
  const { createStationInfo } = await import('../server/stationinfo.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'photo-unit-')); dirs.push(dir);
  const store = { data: {}, save() {} };
  const si = createStationInfo(store, dir);
  const P = { lat: 39.9, lon: 32.8 };
  const a1 = si.addPhoto('u_a', P, jpeg());
  ok('(a) fotoğraf eklenir', a1.ok && /^[a-f0-9]{16}$/.test(a1.id));
  ok('(a) bildirmeden önce herkes görür', si.summary(P, 'u_b').photos.length === 1 && si.summary(P, 'u_c').photos.length === 1);
  ok('(a) kendi fotoğrafını bildiremez', si.reportPhoto('u_a', a1.id).error === 'kendi fotoğrafın');
  ok('(a) geçersiz kimlik ve olmayan fotoğraf', si.reportPhoto('u_b', 'xyz').error === 'geçersiz' && si.reportPhoto('u_b', 'f'.repeat(16)).error === 'yok');
  ok('(a) bildirme başarılı', si.reportPhoto('u_b', a1.id).ok === true);
  ok('(a) bildirilen fotoğraf başkalarına özetten kalkar (bildiren dahil)', si.summary(P, 'u_b').photos.length === 0 && si.summary(P, 'u_c').photos.length === 0);
  const own = si.summary(P, 'u_a').photos;
  ok('(a) yükleyen kendi gizli fotoğrafını hidden: true ile görür', own.length === 1 && own[0].mine === true && own[0].hidden === true);
  ok('(a) gizli fotoğraf baytları: başkasına yok, yükleyene ve yöneticiye var', si.readPhoto(a1.id, 'u_b') === null && si.readPhoto(a1.id, null, false) === null && Buffer.isBuffer(si.readPhoto(a1.id, 'u_a')) && Buffer.isBuffer(si.readPhoto(a1.id, null, true)));
  ok('(a) aynı kişi tekrar bildirirse tek kayıt', si.reportPhoto('u_b', a1.id).ok && si.reported()[0].reports === 1);
  ok('(a) reported(): id, yükleyen, bildirim sayısı', JSON.stringify(si.reported().map((r) => [r.id, r.by, r.reports])) === JSON.stringify([[a1.id, 'u_a', 1]]));
  ok('(a) geri yükle: herkes yeniden görür, hidden alanı kalkar', si.restorePhoto(a1.id).ok && si.summary(P, 'u_c').photos.length === 1 && !('hidden' in si.summary(P, 'u_a').photos[0]) && si.reported().length === 0);
  ok('(a) geri yüklenen fotoğrafı AYNI kişi tekrar gizleyemez', si.reportPhoto('u_b', a1.id).ok && si.summary(P, 'u_c').photos.length === 1);
  ok('(a) yeni bir kişi bildirirse yeniden gizlenir (2 bildirim)', si.reportPhoto('u_c', a1.id).ok && si.summary(P, 'u_d').photos.length === 0 && si.reported()[0].reports === 2);
  ok('(a) olmayan fotoğrafı geri yükleme: yok', si.restorePhoto('f'.repeat(16)).error === 'yok');
  ok('(a) başkası gizli fotoğrafı silemez; yükleyen ve yönetici silebilir', si.deletePhoto('u_b', a1.id, false).error === 'yetkisiz' && si.deletePhoto('u_a', a1.id, false).ok === true && si.summary(P, 'u_a').photos.length === 0 && !existsSync(join(dir, a1.id + '.jpg')));
  // bildiren hesap silinince kimliği kalkar
  const a2 = si.addPhoto('u_a', P, jpeg());
  si.reportPhoto('u_x', a2.id); si.reportPhoto('u_y', a2.id);
  si.forget('u_x');
  const ph = Object.values(store.data.stationInfo).flatMap((c) => c.photos).find((x) => x.id === a2.id);
  ok('(a) forget(bildiren): bildiren kimliği kalkar, fotoğraf gizli kalır', JSON.stringify(ph.reports) === JSON.stringify(['u_y']) && ph.hidden === true);
  // gizli fotoğraf kişi başı 3 sınırına sayılır
  const a3 = si.addPhoto('u_a', P, jpeg()), a4 = si.addPhoto('u_a', P, jpeg());
  ok('(a) gizli fotoğraf kişi başına 3 sınırına dahil', a3.ok && a4.ok && si.addPhoto('u_a', P, jpeg()).error?.includes('hakkın doldu'));
} catch (e) { ok('Bölüm (a) çalıştı: ' + e.message, false); }

// ---- (b) uçtan uca ----
const TOK = { a: 'A'.repeat(30), b: 'B'.repeat(30), c: 'C'.repeat(30) };
const CODE = 'test-dummy-access-code-0123456789';
try {
  const dir = mkdtempSync(join(tmpdir(), 'photo-e2e-')); dirs.push(dir);
  const now = Date.now();
  const user = (id) => ({ id, email: id + '@test.invalid', name: id, createdAt: now, premiumUntil: now + 30 * 86400e3 });
  const sess = (uid) => ({ uid, createdAt: now, lastSeen: now, exp: now + 86400e3 });
  writeFileSync(join(dir, 'db.json'), JSON.stringify({ users: { u_a: user('u_a'), u_b: user('u_b'), u_c: user('u_c') }, invites: {}, docs: {}, sessions: { [sha256(TOK.a)]: sess('u_a'), [sha256(TOK.b)]: sess('u_b'), [sha256(TOK.c)]: sess('u_c') } }));
  const blank = Object.fromEntries(['MAPBOX_TOKEN', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'MAPBOX_MAP_TOKEN', 'GOOGLE_MAP_ID', 'TRUST_PROXY', 'TRUST_CF_HEADER', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'ADMIN_TOKEN_TTL_SEC', 'RATE_PER_MIN'].map((k) => [k, '']));
  const child = spawn(process.execPath, ['server/proxy.mjs'], { cwd: ROOT, env: { ...process.env, ...blank, PREMIUM_REQUIRED: '1', PORT: '18840', HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out.slice(0, 300));
  const call = async (method, path, { tok, code, body, raw } = {}) => {
    const headers = {};
    if (tok) headers.Authorization = 'Bearer ' + tok;
    if (code) headers['X-Access-Code'] = CODE;
    if (body !== undefined) headers['Content-Type'] = raw ? 'image/jpeg' : 'application/json';
    const r = await fetch('http://127.0.0.1:18840' + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {}
    return { status: r.status, json: j, buf, type: r.headers.get('content-type') };
  };
  const Q = '?lat=39.900000&lon=32.800000';
  const info = async (tok) => (await call('POST', '/v1/station/info', { tok, body: { lat: 39.9, lon: 32.8 } })).json;

  const up = await call('POST', '/v1/station/photo' + Q, { tok: TOK.a, body: jpeg(), raw: true });
  const id = up.json?.id;
  ok('(b) A fotoğraf yükler', up.status === 200 && /^[a-f0-9]{16}$/.test(id || ''));
  ok('(b) B fotoğrafı özetten görür ve indirir', (await info(TOK.b)).photos.length === 1 && (await call('GET', '/v1/station/photo/' + id, { tok: TOK.b })).status === 200);
  ok('(b) kimliksiz bildirme reddedilir (401)', (await call('POST', `/v1/station/photo/${id}/report`)).status === 401);
  ok('(b) A kendi fotoğrafını bildiremez (400)', (await call('POST', `/v1/station/photo/${id}/report`, { tok: TOK.a })).status === 400);
  ok('(b) olmayan fotoğraf bildirimi 404', (await call('POST', `/v1/station/photo/${'f'.repeat(16)}/report`, { tok: TOK.b })).status === 404);
  const rep = await call('POST', `/v1/station/photo/${id}/report`, { tok: TOK.b });
  ok('(b) B bildirir (200)', rep.status === 200 && rep.json?.ok === true);
  ok('(b) bildirilen fotoğraf B ve C için özetten kalkar, indirilemez (404)', (await info(TOK.b)).photos.length === 0 && (await info(TOK.c)).photos.length === 0 && (await call('GET', '/v1/station/photo/' + id, { tok: TOK.c })).status === 404);
  const ownInfo = (await info(TOK.a)).photos;
  ok('(b) A kendi gizli fotoğrafını hidden ile görür ve indirebilir', ownInfo.length === 1 && ownInfo[0].hidden === true && (await call('GET', '/v1/station/photo/' + id, { tok: TOK.a })).status === 200);
  ok('(b) bildirenin kimliği özette hiç yok', !JSON.stringify(await info(TOK.a)).includes('u_b') && !JSON.stringify(await info(TOK.c)).includes('u_b'));

  ok('(b) yönetici kodsuz /admin/photos reddedilir', (await call('GET', '/admin/photos')).status === 401);
  ok('(b) normal kullanıcı /admin/photos göremez', (await call('GET', '/admin/photos', { tok: TOK.b })).status !== 200);
  const lst = await call('GET', '/admin/photos', { code: true });
  ok('(b) yönetici kuyruğu: id, yükleyen e-postası, 1 bildirim', lst.status === 200 && lst.json.photos.length === 1 && lst.json.photos[0].id === id && lst.json.photos[0].who === 'u_a@test.invalid' && lst.json.photos[0].reports === 1);
  const im = await call('GET', `/admin/photos/${id}/image`, { code: true });
  ok('(b) yönetici gizli fotoğrafı görür (image/jpeg, no-store)', im.status === 200 && im.type === 'image/jpeg' && im.buf.length === 1500);
  const sm = (await call('GET', '/admin/summary', { code: true })).json;
  ok('(b) /admin/summary moderation.reportedPhotos = 1', sm.moderation?.reportedPhotos === 1);

  ok('(b) yönetici geri yükler: herkes yeniden görür', (await call('POST', `/admin/photos/${id}/restore`, { code: true })).status === 200 && (await info(TOK.c)).photos.length === 1 && (await call('GET', '/admin/photos', { code: true })).json.photos.length === 0);
  await call('POST', `/v1/station/photo/${id}/report`, { tok: TOK.b });
  ok('(b) B geri yüklenen fotoğrafı tekrar gizleyemez', (await info(TOK.c)).photos.length === 1);
  await call('POST', `/v1/station/photo/${id}/report`, { tok: TOK.c });
  ok('(b) yeni bildiren (C) yeniden gizler, 2 bildirim', (await info(TOK.b)).photos.length === 0 && (await call('GET', '/admin/photos', { code: true })).json.photos[0].reports === 2);

  ok('(b) başkası fotoğrafı silemez (403)', (await call('DELETE', '/v1/station/photo/' + id, { tok: TOK.b })).status === 403);
  const rs = await call('POST', `/admin/photos/${'f'.repeat(16)}/restore`, { code: true });
  ok('(b) olmayan fotoğrafı geri yükleme 404', rs.status === 404);
  ok('(b) yönetici siler: kuyruk boş, yükleyen de göremez, dosya yok', (await call('DELETE', `/admin/photos/${id}`, { code: true })).status === 200 && (await info(TOK.a)).photos.length === 0 && (await call('GET', '/v1/station/photo/' + id, { tok: TOK.a })).status === 404 && !existsSync(join(dir, 'photos', id + '.jpg')));

  // yükleyen kendi fotoğrafını siler (bildirilmemiş)
  const up2 = await call('POST', '/v1/station/photo' + Q, { tok: TOK.a, body: jpeg(), raw: true });
  ok('(b) yükleyen kendi fotoğrafını siler (200), sonra yok', up2.status === 200 && (await call('DELETE', '/v1/station/photo/' + up2.json.id, { tok: TOK.a })).status === 200 && (await info(TOK.a)).photos.length === 0);

  // günlük bildirim hakkı: 10; 11. bildirim 429
  const ids = [];
  for (const [i, lon] of [[0, 33.1], [1, 33.2], [2, 33.3], [3, 33.4], [4, 33.5], [5, 33.6], [6, 33.7], [7, 33.8], [8, 33.9], [9, 34.0], [10, 34.1]]) {
    const u = await call('POST', `/v1/station/photo?lat=39.5&lon=${lon}`, { tok: TOK.a, body: jpeg(), raw: true });
    ids.push(u.json?.id);
  }
  let last = 0; for (const x of ids) last = (await call('POST', `/v1/station/photo/${x}/report`, { tok: TOK.b })).status;
  ok('(b) günlük bildirim hakkı 10: 11. bildirim 429', ids.every(Boolean) && last === 429);

  await new Promise((r) => setTimeout(r, 1500)); // db.json gecikmeli yazılır (store.save ≈ 800 ms)
  const db = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));
  ok('(b) bildirilen fotoğrafın bildirenleri db.json\'da kalıcı (kimlikle, dışarı verilmez)', Object.values(db.stationInfo || {}).flatMap((c) => c.photos).some((p) => p.hidden && p.reports?.includes('u_b')));
  ok('(b) sunucu çıktısında hata yok', !/Error|TypeError|Unhandled/.test(out));
} catch (e) { ok('Bölüm (b) çalıştı: ' + e.message, false); }

// ---- (c) istemci ve yönetim sayfası ----
{
  const card = readFileSync(join(ROOT, 'js/ui/stationCard.js'), 'utf8');
  const sinfo = readFileSync(join(ROOT, 'js/account/stationInfo.js'), 'utf8');
  const admin = readFileSync(join(ROOT, 'server/admin.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'css/styles.css'), 'utf8');
  ok('(c) istemci: reportPhoto POST /v1/station/photo/<id>/report', /export async function reportPhoto\(id\)/.test(sinfo) && sinfo.includes('/report`') && /method: 'POST'/.test(sinfo.split('reportPhoto')[1] || ''));
  ok('(c) kart: başkasının fotoğrafında "🚩 Bildir" (onaylı), kendisinde "🗑 Sil", bildirilmişse not', card.includes("'🚩 Bildir'") && card.includes('confirm(') && card.includes("'🗑 Sil'") && card.includes('Bildirildi, inceleme bekliyor'));
  ok('(c) kart: küçük resimde mine/flagged sınıfı ve ipucu', card.includes("' mine'") && card.includes("' flagged'") && card.includes('Yeşil çerçeveli fotoğraflar senin'));
  ok('(c) css: .photo-th.mine ve .flagged', css.includes('.photo-th.mine') && css.includes('.photo-th.flagged'));
  ok('(c) yönetim: Fotoğraflar sekmesi, kuyruk, Geri yükle / Sil, innerHTML yok', admin.includes('data-t="photos"') && admin.includes('drawPhotos') && admin.includes('/admin/photos') && admin.includes('Geri yükle') && !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(admin));
  const man = readFileSync(join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  ok('(c) Android: allowBackup=false ve dataExtractionRules', man.includes('android:allowBackup="false"') && man.includes('@xml/data_extraction_rules') && existsSync(join(ROOT, 'android/app/src/main/res/xml/data_extraction_rules.xml')));
}

for (const c of children) c.kill();
await new Promise((r) => setTimeout(r, 300));
for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* geçici klasör */ } }
console.log(`${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
