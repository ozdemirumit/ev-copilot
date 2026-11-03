// Hesaplar: davetle kayıt, Google ile giriş (sunucu tarafı OAuth), oturumlar, hesapla senkron ve yönetici işlemleri.
// Telefonda hiçbir anahtar yazılmaz: uygulama bir tarayıcı sekmesinde sunucunun giriş sayfasını açar, giriş bitince sunucu oturumu
// uygulamanın bildiği tek kullanımlık "nonce" ile teslim eder (uygulama yoklar). Google istemci gizlisi yalnızca sunucudadır.
import { createHash, randomBytes } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const rnd = (n = 32) => randomBytes(n).toString('base64url');
const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
/** Giriş onay kodu: nonce'tan türetilen 4 hane (uygulama aynı işlevle hesaplar ve ekranda gösterir; tarayıcıda girilmeden giriş tamamlanmaz). Gizli değildir:
 *  amaç, bir başkasının başlattığı girişe kurbanın habersizce onay vermesini (nonce'u saldırganın seçtiği oturum kaçırma) engellemektir. */
export function loginCode(nonce) {
  let h = 0x811c9dc5;
  for (let i = 0; i < nonce.length; i++) { h ^= nonce.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return String(h % 10000).padStart(4, '0');
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const INVITE = /^[A-Za-z0-9_-]{8,64}$/;

/** Cihazlar arası eşitlenen yerel anahtarlar. Gizli olanlar (ABRP, API anahtarları, oturum, sunucu adresi) bilerek yok. */
export const SYNC_KEYS = new Set([
  'places', 'recentDest', 'vehicle', 'consAdj', 'chargerMin', 'minStopAdd', 'tolerance', 'maxChargeTo', 'allowSlow', 'minArrival', 'cruise',
  'planMode', 'voiceOn', 'lowSoc', 'speedAlert', 'headingUp', 'limitOn', 'operators', 'kCal', 'hist', 'customStations', 'stationOps', 'nearRadius', 'nearAc', 'brandPref',
]);
const MAX_DOC = 450_000; // anahtar başına bayt
const MAX_USER = 3_000_000; // kullanıcı başına toplam bayt
// Geçmiş (yalnızca eklenir, kimlikle tekrar gönderim güvenli): yolculuklar ve şarj oturumları. Değerli veri olduğu için eşitlenen ayarlardan ayrı tutulur.
const HISTORY_KINDS = new Set(['trips', 'charges']);
const MAX_REC = 6000; // kayıt başına bayt
const MAX_RECS = 5000; // kullanıcı ve tür başına kayıt (en çok ~30 MB)

import { validEmail } from './mailer.mjs';

/** Davet e-postasının metni (Türkçe + İngilizce). */
function inviteMail(link, rec) {
  const until = new Date(rec.expiresAt).toLocaleDateString('tr-TR');
  return [
    'Merhaba,', '',
    'EV Co-Pilot uygulamasına davet edildin.', '',
    `1) Bu linke dokun: ${link}`,
    '2) Açılan sayfada Android uygulamasını ya da web uygulamasını seç, "Google ile giriş yap"a bas.',
    `3) Giriş için bu e-postanın Google hesabını kullan${rec.email ? ' (' + rec.email + ')' : ''}.`, '',
    `Davet ${until} tarihine kadar geçerli ve tek kullanımlıktır.${rec.premiumDays ? ` İlk girişinle birlikte ${rec.premiumDays} gün Premium hediye.` : ''}`, '',
    '---',
    'Hello, you have been invited to EV Co-Pilot. Open the link above and sign in with the Google account this email was sent to.',
  ].join('\n');
}

export function createAccounts({ env, store, send, json, readJson, caps, onDelete = () => {}, onLink = null, devicesOf = () => [], costs = null, mailer = null }) {
  const { data } = store;
  const PUBLIC_URL = String(env.PUBLIC_URL || '').replace(/\/+$/, '');
  const APP_URL = env.APP_URL || 'https://ozdemirumit.github.io/ev-copilot/';
  const G_ID = env.GOOGLE_CLIENT_ID || '';
  const G_SECRET = env.GOOGLE_CLIENT_SECRET || '';
  const G_AUTH = env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
  const G_TOKEN = env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
  const ADMINS = new Set(String(env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const SESSION_MS = Number(env.SESSION_DAYS || 180) * 86400e3;
  const googleOn = !!(G_ID && G_SECRET && PUBLIC_URL);

  // ---------- oturum ----------
  // Premium: yönetici hesapları ve premiumUntil süresi dolmamış kullanıcılar. PREMIUM_REQUIRED=0 ise herkes premium sayılır (deneme/beta).
  const PREMIUM_ON = env.PREMIUM_REQUIRED !== '0';
  const isPremium = (u) => !PREMIUM_ON || !!u.admin || (u.premiumUntil || 0) > Date.now();
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, admin: !!u.admin, premium: isPremium(u), premiumUntil: u.premiumUntil || null });
  function makeSession(uid) {
    const token = rnd(32);
    const mine = Object.entries(data.sessions).filter(([, s]) => s.uid === uid).sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (mine.length >= 10) delete data.sessions[mine.shift()[0]]; // kullanıcı başına en çok 10 cihaz
    data.sessions[sha(token)] = { uid, createdAt: Date.now(), lastSeen: Date.now(), exp: Date.now() + SESSION_MS };
    store.save();
    return token;
  }
  /** Authorization: Bearer <oturum> → kullanıcı (devre dışı ya da süresi dolmuşsa null). */
  function userFromRequest(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,80})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const h = sha(m[1]);
    const s = data.sessions[h];
    if (!s || s.exp < Date.now()) { if (s) { delete data.sessions[h]; store.save(); } return null; }
    const u = data.users[s.uid];
    if (!u || u.disabled) return null;
    if (Date.now() - s.lastSeen > 3600e3) { s.lastSeen = Date.now(); store.save(); }
    return u;
  }
  const hasCredentials = (req) => !!req.headers.authorization;

  // ---------- davet ----------
  function findInvite(code) {
    if (!code || !INVITE.test(code)) return null;
    const h = sha(code);
    return Object.values(data.invites).find((i) => i.hash === h) || null;
  }
  const inviteState = (i) => (!i ? 'invalid' : i.revoked ? 'revoked' : i.usedBy ? 'used' : i.expiresAt < Date.now() ? 'expired' : 'ok');

  /** Giriş yapan kişiyi bul ya da (geçerli davetle) oluştur. Dönüş: { user } veya { error }. */
  function signIn(provider, sub, email, name, inviteCode) {
    let u = Object.values(data.users).find((x) => x.provider === provider && x.sub === sub);
    if (u) {
      if (u.disabled) return { error: 'disabled' };
      Object.assign(u, { email, name, lastLogin: Date.now() });
      store.save();
      return { user: u };
    }
    const admin = ADMINS.has(String(email).toLowerCase());
    if (!admin) {
      const inv = findInvite(inviteCode);
      if (!inviteCode) return { error: 'invite_required' };
      const st = inviteState(inv);
      if (st !== 'ok') return { error: 'invite_' + st };
      if (inv.email && inv.email !== String(email).toLowerCase()) return { error: 'invite_email' }; // davet belirli bir e-postaya yazılmışsa yalnızca o Google hesabı kullanabilir
      inv.usedBy = 'pending';
      u = { id: 'u_' + rnd(9), provider, sub, email, name, admin: false, disabled: false, createdAt: Date.now(), lastLogin: Date.now() };
      if (inv.premiumDays) u.premiumUntil = Date.now() + inv.premiumDays * 86400e3; // davetle gelen Premium süresi ilk girişte başlar
      inv.usedBy = u.id;
      inv.usedAt = Date.now();
    } else {
      u = { id: 'u_' + rnd(9), provider, sub, email, name, admin: true, disabled: false, createdAt: Date.now(), lastLogin: Date.now() };
    }
    data.users[u.id] = u;
    store.save();
    return { user: u };
  }

  // ---------- giriş akışı (tarayıcıda Google, uygulama nonce ile yoklar) ----------
  const pend = new Map(); // nonce → { state, invite, exp, result }
  const byState = new Map(); // state → nonce
  const byConfirm = new Map(); // onay kimliği → nonce
  setInterval(() => {
    for (const [n, p] of pend) if (p.exp < Date.now()) { pend.delete(n); byState.delete(p.state); if (p.cid) byConfirm.delete(p.cid); }
  }, 60000).unref();

  const page = (res, status, title, msg) => send(res, status, `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EV Co-Pilot</title>`
    + `<style>body{font:16px system-ui,sans-serif;background:#0b0f14;color:#e8eef5;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}main{max-width:420px}h1{font-size:22px}a{color:#2ee6a6}p{color:#a9b6c6;line-height:1.5}.btn{display:inline-block;margin:6px;padding:12px 18px;border-radius:12px;background:#1b2530;border:1px solid #2c3a49;text-decoration:none}</style></head><body><main><h1>${title}</h1><p>${msg}</p></main></body></html>`,
  { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });

  const ERR = {
    invite_required: ['Davet gerekli', 'Bu uygulamaya yalnızca davetle girilir. Davet linkini açıp tekrar dene. (An invitation is required.)'],
    invite_invalid: ['Davet geçersiz', 'Bu davet kodu tanınmadı. Yeni bir davet iste. (Invalid invitation.)'],
    invite_used: ['Davet kullanılmış', 'Bu davet daha önce kullanılmış. Yeni bir davet iste. (Invitation already used.)'],
    invite_expired: ['Davetin süresi dolmuş', 'Yeni bir davet iste. (Invitation expired.)'],
    invite_email: ['Davet başka bir hesap için', 'Bu davet belirli bir e-posta adresine yazılmış. Davetin gönderildiği Google hesabıyla giriş yap. (This invitation is for a different Google account.)'],
    invite_revoked: ['Davet iptal edilmiş', 'Yeni bir davet iste. (Invitation revoked.)'],
    disabled: ['Hesap kapalı', 'Bu hesap yönetici tarafından kapatılmış. (Account disabled.)'],
    code: ['Kod yanlış', 'Çok fazla yanlış kod girildi. Uygulamaya dönüp girişi yeniden başlat. (Too many wrong codes. Start the sign-in again in the app.)'],
    google: ['Giriş tamamlanamadı', 'Google girişi başarısız oldu. Uygulamaya dönüp tekrar dene. (Google sign-in failed.)'],
  };

  function decodeJwt(t) {
    try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
  }

  async function googleCallback(req, res, url) {
    const state = url.searchParams.get('state') || '';
    const nonce = byState.get(state);
    const p = nonce && pend.get(nonce);
    if (!p || p.exp < Date.now()) return page(res, 400, 'Süre doldu', 'Giriş isteğinin süresi doldu. Uygulamaya dönüp tekrar dene. (Sign-in request expired.)');
    // Aynı geri çağrı adresi ikinci kez yüklenebilir (sayfa yenileme, sekme geri yükleme, önizleme): Google kodu tek kullanımlıktır, bu yüzden sonuç yeniden gösterilir
    if (p.identity && p.state === state) return confirmPage(res, p);
    if (p.result) { if (p.result.status === 'ok') return page(res, 200, '✅ Giriş tamam', 'Uygulamaya dönebilirsin; kendiliğinden devam eder. (Signed in. You can return to the app.)'); const [t, m] = ERR[p.result.error] || ERR.google; return page(res, 400, t, m); }
    if (p.busy) return page(res, 200, 'Giriş sürüyor', 'Birkaç saniye sonra bu sayfayı yenile. (Sign-in in progress, reload in a few seconds.)');
    p.busy = true;
    const fail = (key) => { p.busy = false; byState.delete(state); p.result = { status: 'error', error: key }; const [t, m] = ERR[key] || ERR.google; page(res, 400, t, m); };
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) return fail('google');
    let idt;
    try {
      const r = await fetch(G_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: G_ID, client_secret: G_SECRET, redirect_uri: `${PUBLIC_URL}/auth/google/callback`, grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        let why = '';
        try { const e = await r.json(); why = `${e.error || ''} ${e.error_description || ''}`.trim(); } catch { /* gövde yok */ }
        console.error(`google: belirteç isteği reddedildi HTTP ${r.status} ${why}`); // neden günlüğe yazılır (anahtarlar yazılmaz): invalid_client = kimlik/gizli yanlış, redirect_uri_mismatch = yönlendirme adresi farklı
        return fail('google');
      }
      idt = decodeJwt((await r.json()).id_token); // Google'ın belirteç uç noktasından TLS ile doğrudan geldi: imza ayrıca doğrulanmaz (OIDC Core 3.1.3.7)
    } catch (err) { console.error('google: belirteç isteği başarısız:', err?.message || err); return fail('google'); }
    const aud = Array.isArray(idt?.aud) ? idt.aud : [idt?.aud];
    const checks = { iss: !!idt && /^(https:\/\/)?accounts\.google\.com$/.test(idt.iss), aud: aud.includes(G_ID), exp: !!idt && idt.exp * 1000 > Date.now(), sub: !!idt?.sub, email: !!idt?.email, verified: idt?.email_verified !== false };
    if (!idt || Object.values(checks).some((v) => !v)) { console.error('google: kimlik belirteci doğrulanamadı', JSON.stringify(checks)); return fail('google'); }
    // Hesap hemen açılmaz: giriş, uygulamada gösterilen 4 haneli kod tarayıcıda girilince tamamlanır (başkasının başlattığı girişi habersizce onaylamayı önler)
    p.identity = { sub: String(idt.sub), email: String(idt.email), name: String(idt.name || idt.email).slice(0, 80) };
    p.cid = rnd(16);
    p.tries = 0;
    byConfirm.set(p.cid, nonce);
    p.busy = false;
    confirmPage(res, p);
  }

  function confirmPage(res, p, error = '') {
    send(res, 200, `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EV Co-Pilot</title>`
      + `<style>body{font:16px system-ui,sans-serif;background:#0b0f14;color:#e8eef5;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}main{max-width:420px}h1{font-size:22px}p{color:#a9b6c6;line-height:1.5}b{color:#e8eef5}.err{color:#ff8a8a}input{font:inherit;font-size:28px;letter-spacing:8px;text-align:center;width:9ch;padding:10px;border-radius:12px;border:1px solid #2c3a49;background:#1b2530;color:#e8eef5}button{display:block;margin:16px auto 0;font:inherit;padding:12px 22px;border-radius:12px;border:1px solid #2c3a49;background:#1b2530;color:#2ee6a6;font-weight:600}</style></head>`
      + `<body><main><h1>🔐 Giriş kodunu gir</h1><p>Hesap: <b>${esc(p.identity.email)}</b><br>Girişi başlattığın uygulamada gösterilen <b>4 haneli kodu</b> yaz. (Enter the 4-digit code shown in the app where you started sign-in.)</p>`
      + `<p>Bu girişi sen başlatmadıysan ya da uygulamada kod görmediysen sayfayı kapat: biri seni kandırmaya çalışıyor olabilir. (If you did not start this sign-in, close this page.)</p>`
      + (error ? `<p class="err">${esc(error)}</p>` : '')
      + `<form method="get" action="/auth/confirm" autocomplete="off"><input type="hidden" name="c" value="${esc(p.cid)}"><input name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autofocus required><button type="submit">Girişi tamamla</button></form></main></body></html>`,
    { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'", 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
  }

  /** Onay adımı: kod doğruysa giriş tamamlanır (davet kullanılır, hesap açılır, oturum verilir). */
  function confirmLogin(req, res, url) {
    const cid = url.searchParams.get('c') || '';
    const nonce = byConfirm.get(cid);
    const p = nonce && pend.get(nonce);
    if (!p || !p.identity || p.exp < Date.now()) return page(res, 400, 'Süre doldu', 'Giriş isteğinin süresi doldu. Uygulamaya dönüp tekrar dene. (Sign-in request expired.)');
    const fail = (key) => { byConfirm.delete(cid); byState.delete(p.state); delete p.identity; p.result = { status: 'error', error: key }; const [t, m] = ERR[key] || ERR.google; page(res, 400, t, m); };
    if ((url.searchParams.get('code') || '').trim() !== loginCode(nonce)) {
      if (++p.tries >= 5) return fail('code');
      return confirmPage(res, p, 'Kod yanlış, tekrar dene. (Wrong code, try again.)');
    }
    const { sub, email, name } = p.identity;
    byConfirm.delete(cid);
    byState.delete(p.state);
    delete p.identity;
    const out = signIn('google', sub, email, name, p.invite);
    if (out.error) { p.result = { status: 'error', error: out.error }; const [t, m] = ERR[out.error] || ERR.google; return page(res, 400, t, m); }
    p.result = { status: 'ok', session: makeSession(out.user.id), user: publicUser(out.user) };
    page(res, 200, '✅ Giriş tamam', 'Uygulamaya dönebilirsin; kendiliğinden devam eder. (Signed in. You can return to the app.)');
  }

  function body404(res) { json(res, 404, { error: 'yol yok' }); }

  /** Kimlik gerektirmeyen yollar. true dönerse yanıt verildi. */
  async function handlePublic(req, res, url, ip) {
    const p = url.pathname;
    if (p === '/v1/config' && req.method === 'GET') {
      json(res, 200, { providers: googleOn ? ['google'] : [], inviteRequired: true });
      return true;
    }
    if (p === '/auth/google' && req.method === 'GET') {
      if (!googleOn) { page(res, 501, 'Giriş kapalı', 'Sunucuda Google girişi ayarlanmamış.'); return true; }
      const nonce = url.searchParams.get('nonce') || '';
      const invite = url.searchParams.get('invite') || '';
      // tek adres en çok 10 bekleyen giriş açabilir (herkesin girişini kilitleyemez)
      if (!NONCE.test(nonce) || (invite && !INVITE.test(invite)) || pend.size > 500 || (!pend.has(nonce) && [...pend.values()].filter((x) => x.ip === ip).length >= 10)) { page(res, 400, 'Geçersiz istek', 'Uygulamaya dönüp tekrar dene.'); return true; }
      const state = rnd(24);
      pend.set(nonce, { ip, state, invite, exp: Date.now() + 10 * 60e3, result: null });
      byState.set(state, nonce);
      const q = new URLSearchParams({ client_id: G_ID, redirect_uri: `${PUBLIC_URL}/auth/google/callback`, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
      res.writeHead(302, { Location: `${G_AUTH}?${q}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
      return true;
    }
    if (p === '/auth/google/callback' && req.method === 'GET') { await googleCallback(req, res, url); return true; }
    if (p === '/auth/confirm' && req.method === 'GET') { confirmLogin(req, res, url); return true; }
    if (p === '/v1/auth/poll' && req.method === 'GET') {
      const nonce = url.searchParams.get('nonce') || '';
      const e = NONCE.test(nonce) ? pend.get(nonce) : null;
      if (!e || e.exp < Date.now()) { json(res, 200, { status: 'expired' }); return true; }
      if (!e.result) { json(res, 200, { status: 'pending' }); return true; }
      pend.delete(nonce); // sonuç bir kez teslim edilir
      if (e.result.status === 'ok') onLink?.(req.headers['x-device-id'], e.result.user.id, ip); // giriş yapan cihazın anonim kimliği hesaba bağlanır
      byState.delete(e.state);
      json(res, 200, e.result);
      return true;
    }
    const inv = /^\/i\/([A-Za-z0-9_-]{8,64})$/.exec(p);
    if (inv && req.method === 'GET') {
      const st = inviteState(findInvite(inv[1]));
      if (st !== 'ok') { const [t, m] = ERR['invite_' + st] || ERR.invite_invalid; page(res, 404, t, m); return true; }
      const code = inv[1];
      send(res, 200, `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EV Co-Pilot</title>`
        + `<style>body{font:16px system-ui,sans-serif;background:#0b0f14;color:#e8eef5;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}main{max-width:420px}h1{font-size:22px}p{color:#a9b6c6;line-height:1.5}.btn{display:block;margin:10px 0;padding:14px 18px;border-radius:12px;background:#1b2530;border:1px solid #2c3a49;color:#2ee6a6;text-decoration:none;font-weight:600}</style></head>`
        + `<body><main><h1>🔌 EV Co-Pilot daveti</h1><p>Davet edildin. Uygulamayı aç ve Google ile giriş yap. (You have been invited.)</p>`
        + `<a class="btn" href="evcopilot://invite?code=${code}">📱 Android uygulamasında aç</a>`
        + `<a class="btn" href="${APP_URL}?invite=${code}">🌐 Web uygulamasında aç</a>`
        + (PUBLIC_URL ? `<a class="btn" href="${PUBLIC_URL}/app">📥 Android uygulamasını indir (kurulu değilse)</a>` : '')
        + `</main></body></html>`,
      { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });
      return true;
    }
    return false;
  }

  // ---------- kullanıcı ve yönetici yolları (kimlik doğrulanmış) ----------
  const usedBytes = (uid) => Object.values(data.docs[uid] || {}).reduce((a, d) => a + JSON.stringify(d.v).length, 0);

  /** id: { kind: 'user'|'legacy', user?, admin }. true dönerse yanıt verildi. */
  async function handleAuthed(req, res, url, id) {
    const p = url.pathname;
    if (id.kind === 'user') {
      if (p === '/v1/me' && req.method === 'GET') { json(res, 200, { user: publicUser(id.user), caps: caps() }); return true; }
      if (p === '/v1/auth/logout' && req.method === 'POST') {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        if (m) delete data.sessions[sha(m[1])];
        store.save();
        json(res, 200, { ok: true });
        return true;
      }
      if (p === '/v1/me' && req.method === 'DELETE') { // hesabı ve tüm verisini sil
        const uid = id.user.id;
        delete data.users[uid];
        delete data.docs[uid];
        if (data.history) delete data.history[uid];
        onDelete(uid); // fiyat ve topluluk bildirimleri de silinir
        for (const [h, s] of Object.entries(data.sessions)) if (s.uid === uid) delete data.sessions[h];
        store.save();
        json(res, 200, { ok: true });
        return true;
      }
      const hm = /^\/v1\/history\/([a-z]{1,12})$/.exec(p);
      if (hm && HISTORY_KINDS.has(hm[1])) {
        const bucket = ((data.history ||= {})[id.user.id] ||= {})[hm[1]] ||= {};
        if (req.method === 'POST') { // { items: [{ id, t, ... }] } kimliğe göre ekler/günceller
          const b = await readJson(req, 400_000);
          if (!b || !Array.isArray(b.items) || b.items.length > 500) { json(res, 400, { error: 'geçersiz gövde' }); return true; }
          let saved = 0;
          for (const it of b.items) {
            if (!it || typeof it.id !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(it.id) || /^__/.test(it.id) || !Number.isFinite(it.t)) continue; // '__proto__' gibi kimlikler nesne prototipini bozmasın
            if (JSON.stringify(it).length > MAX_REC) continue;
            if (!Object.hasOwn(bucket, it.id) && Object.keys(bucket).length >= MAX_RECS) continue;
            bucket[it.id] = { ...it, t: Math.min(it.t, Date.now() + 86400e3) };
            saved++;
          }
          store.save();
          json(res, 200, { ok: true, saved, total: Object.keys(bucket).length });
          return true;
        }
        if (req.method === 'GET') {
          const since = Number(url.searchParams.get('since')) || 0;
          const limit = Math.min(2000, Number(url.searchParams.get('limit')) || 500);
          const items = Object.values(bucket).filter((r) => r.t > since).sort((a, b) => a.t - b.t).slice(0, limit);
          json(res, 200, { items, total: Object.keys(bucket).length });
          return true;
        }
        if (req.method === 'DELETE') { delete (data.history[id.user.id] || {})[hm[1]]; store.save(); json(res, 200, { ok: true }); return true; }
      }
      if (p === '/v1/sync' && req.method === 'GET') { json(res, 200, { docs: data.docs[id.user.id] || {} }); return true; }
      const m = /^\/v1\/sync\/([A-Za-z0-9_]{1,40})$/.exec(p);
      if (m && req.method === 'PUT') {
        const key = m[1];
        if (!SYNC_KEYS.has(key)) { json(res, 400, { error: 'anahtar eşitlenmez' }); return true; }
        const b = await readJson(req, MAX_DOC + 2000);
        if (b === undefined || b === null || b.v === undefined || !Number.isFinite(b.u)) { json(res, 400, { error: 'geçersiz gövde' }); return true; }
        const size = JSON.stringify(b.v).length;
        const docs = (data.docs[id.user.id] ||= {});
        if (size > MAX_DOC || usedBytes(id.user.id) - JSON.stringify(docs[key]?.v ?? '').length + size > MAX_USER) { json(res, 413, { error: 'veri çok büyük' }); return true; }
        if (docs[key] && docs[key].u > b.u) { json(res, 409, { current: docs[key] }); return true; } // daha yeni kayıt var
        docs[key] = { u: Math.min(b.u, Date.now() + 60000), v: b.v };
        store.save();
        json(res, 200, { ok: true, u: docs[key].u });
        return true;
      }
    }
    // yönetici: eski erişim kodu ya da yönetici hesabı
    if (id.admin && p.startsWith('/admin/')) {
      if (p === '/admin/restart' && req.method === 'POST') { // sunucu kodunu güncelledikten sonra: süreç kapanır, Windows hizmeti (NSSM) 5 sn içinde yeniden başlatır
        store.flush();
        json(res, 200, { ok: true, note: 'yeniden başlıyor' });
        setTimeout(() => process.exit(0), 300);
        return true;
      }
      // Premium ver/kaldır: { email | userId, days } (days: 0 ya da yoksa kaldırır; mevcut süre varsa üstüne eklenir)
      if (p === '/admin/premium' && req.method === 'POST') {
        const b = (await readJson(req, 2000)) || {};
        const u = Object.values(data.users).find((x) => (b.userId && x.id === b.userId) || (b.email && String(x.email).toLowerCase() === String(b.email).toLowerCase()));
        if (!u) { json(res, 404, { error: 'kullanıcı yok' }); return true; }
        const days = Math.min(3650, Math.max(0, Number(b.days) || 0));
        if (b.until != null) { // kesin bitiş tarihi (ms ya da ISO); geçmiş/geçersizse Premium kaldırılır
          const t = typeof b.until === 'number' ? b.until : Date.parse(b.until);
          u.premiumUntil = Number.isFinite(t) && t > Date.now() ? Math.min(t, Date.now() + 3650 * 86400e3) : null;
        } else u.premiumUntil = days ? Math.max(Date.now(), u.premiumUntil || 0) + days * 86400e3 : null;
        store.save();
        json(res, 200, { ok: true, email: u.email, premiumUntil: u.premiumUntil });
        return true;
      }
      if (p === '/admin/invites' && req.method === 'POST') {
        const b = (await readJson(req, 2000)) || {};
        const code = rnd(9);
        const days = Math.min(90, Math.max(1, Number(b.days) || 7));
        const email = b.email ? String(b.email).trim().toLowerCase() : '';
        if (email && !validEmail(email)) { json(res, 400, { error: 'geçersiz e-posta' }); return true; }
        const premiumDays = Math.min(3650, Math.max(0, Math.round(Number(b.premiumDays) || 0)));
        const rec = { id: 'i_' + rnd(6), hash: sha(code), label: String(b.label || '').slice(0, 60), email: email || null, premiumDays: premiumDays || 0, createdAt: Date.now(), expiresAt: Date.now() + days * 86400e3, usedBy: null, revoked: false };
        data.invites[rec.id] = rec;
        store.save();
        const link = PUBLIC_URL ? `${PUBLIC_URL}/i/${code}` : null;
        let emailed = false;
        let emailError = null;
        if (email && b.send && link) {
          if (!mailer) emailError = 'E-posta gönderimi ayarlı değil (SMTP_USER/SMTP_PASS)';
          else {
            try {
              await mailer.send({ to: email, subject: 'EV Co-Pilot daveti', text: inviteMail(link, rec) });
              emailed = true;
            } catch (err) { emailError = String(err.message).slice(0, 160); console.error('davet e-postası:', emailError); }
          }
        }
        json(res, 200, { id: rec.id, code, link, expiresAt: rec.expiresAt, email: rec.email, premiumDays: rec.premiumDays, emailed, emailError });
        return true;
      }
      if (p === '/admin/invites' && req.method === 'GET') {
        json(res, 200, { invites: Object.values(data.invites).map((i) => ({ id: i.id, label: i.label, email: i.email || null, premiumDays: i.premiumDays || 0, state: inviteState(i), createdAt: i.createdAt, expiresAt: i.expiresAt, usedBy: i.usedBy })) });
        return true;
      }
      const di = /^\/admin\/invites\/(i_[A-Za-z0-9_-]+)$/.exec(p);
      if (di && req.method === 'DELETE') { if (data.invites[di[1]]) data.invites[di[1]].revoked = true; store.save(); json(res, 200, { ok: true }); return true; }
      if (p === '/admin/users' && req.method === 'GET') {
        json(res, 200, { users: Object.values(data.users).map((u) => ({ id: u.id, email: u.email, name: u.name, admin: u.admin, disabled: u.disabled, createdAt: u.createdAt, lastLogin: u.lastLogin, premiumUntil: u.premiumUntil || null, mapProvider: u.mapProvider || null, bytes: usedBytes(u.id), trips: Object.keys(data.history?.[u.id]?.trips || {}).length, charges: Object.keys(data.history?.[u.id]?.charges || {}).length, google: costs?.summary(u.id) || null, devices: devicesOf(u.id).length, firstDevice: devicesOf(u.id).reduce((m, d) => Math.min(m, d.firstSeen), Infinity) })) });
        return true;
      }
      if (p === '/admin/costs' && req.method === 'GET') { // kullanıcı başına: Google (calls/usd, eski biçim) + tüm sağlayıcı istekleri (usage: tür → bugün / bu ay / toplam)
        const rows = (costs?.keys() || []).map((k) => { const u = data.users[k]; return { id: k, email: u?.email || (k === 'code' ? 'yönetici kodu' : k === '_silinen' ? '(silinen hesaplar)' : k), admin: k === 'code' || !!u?.admin, ...costs.summary(k), usage: costs.counts(k) }; });
        json(res, 200, { unitUsd: costs?.unit ?? null, rows, kinds: costs?.kinds || [], totals: costs?.totals() || {}, estimate: costs?.estimate() || {} }); // estimate: sağlayıcı geneli, ücretsiz kota düşülmüş; satırların brüt USD'si istemcide estimate[tür].unit ile
        return true;
      }
      const du = /^\/admin\/users\/(u_[A-Za-z0-9_-]+)\/(disable|enable)$/.exec(p);
      if (du && req.method === 'POST') {
        const u = data.users[du[1]];
        if (!u) { body404(res); return true; }
        u.disabled = du[2] === 'disable';
        if (u.disabled) for (const [h, s] of Object.entries(data.sessions)) if (s.uid === u.id) delete data.sessions[h];
        store.save();
        json(res, 200, { ok: true });
        return true;
      }
    }
    return false;
  }

  return { handlePublic, handleAuthed, userFromRequest, hasCredentials, googleOn, ADMINS, isPremium };
}
