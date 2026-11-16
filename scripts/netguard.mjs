// YALNIZ TEST: harici ağ engelleyicisi. Uygulama/sunucu kodu bu dosyayı içe aktarmaz; paketlenmez.
// Kullanım: NODE_OPTIONS="--import=file:///…/scripts/netguard.mjs" NETGUARD_LOG=<dosya> node scripts/test-x.mjs
// (ya da doğrudan: node scripts/run-tests-guarded.mjs — ön denetim + check.mjs + tüm scripts/test-*.mjs).
//
// Yalnız loopback (127.0.0.0/8, ::1, ::ffff:127.0.0.0/104, "localhost") ve yerel IPC (pipe/unix soket) izinlidir.
// Kapsanan yollar (depo dışı netguard-tmp/netguard.mjs ve d3t0-logs/netguard-fixed.mjs'deki açıklar dahil):
//   - net.Socket.prototype.connect: net.connect/createConnection (dizi biçimli normalleşmiş argüman), tls, http(s),
//     http2, fetch/undici, WebSocket, SMTP. Özel `lookup` seçeneğinin döndürdüğü adres de loopback olmalı.
//   - dns.lookup / dns.promises.lookup: yerel olmayan ad reddedilir; "localhost" sonucu loopback değilse reddedilir.
//   - dns.resolve* / reverse / lookupService (geri çağrı + promises + dns.Resolver + dns.promises.Resolver): HER ZAMAN
//     reddedilir (c-ares doğrudan DNS sunucusuna UDP/TCP gönderir; testlerde meşru kullanımı yok).
//   - dgram: send/connect yerel olmayan adrese, addMembership/addSourceSpecificMembership (çoklu yayın) reddedilir.
//   - global fetch: yerel olmayan URL reddedilir (günlükte ana makine adı görünsün diye; alt katman zaten kapalı).
//   - child_process (spawn/spawnSync/exec/execSync/execFile/execFileSync/fork): çocuğun ortamına bu engelleyici
//     NODE_OPTIONS ile enjekte edilir — test env'i PATH/SystemRoot'a indirse bile (test-package-parity) çocuk korunur.
//     Node dışı çocuk (tarayıcı vb.) korunamayacağı için reddedilir; yalnız git ve icacls izinli (BLOCK_CHILD).
//     TEK İSTİSNA (kullanıcı kararı 2026-11-16, köprü 6883b3a8; kalan tarayıcı ağ riski kabul edildi): BROWSER_SCRIPTS
//     içindeki betik (yalnız test-station-card-layout.mjs) %LOCALAPPDATA%\ms-playwright altındaki chromium-*/chrome.exe
//     ya da webkit-*/Playwright.exe'yi Playwright varsayılan bayraklarıyla (headless + pipe; Chromium'da
//     --disable-background-networking zorunlu; proxy/uzak hata ayıklama portu yasak) ve yalnız Playwright bu engelleyici
//     tarafından sarıldıktan sonra başlatabilir (INFO_BROWSER). Tarayıcının kendi ağ yığını Node engelleyicisinin
//     DIŞINDADIR: tarayıcı ağı "sıfır" DEĞİLDİR; koruma sayfa düzeyindedir:
//   - Playwright (Module._load ile yakalanır): launch yalnız executablePath/headless/timeout; headless:false, args,
//     ignoreDefaultArgs, proxy, launchPersistentContext/launchServer/connect/connectOverCDP, browser.newPage reddedilir;
//     newContext serviceWorkers:'block' zorunlu, proxy yasak; goto yalnız loopback ve ancak '**/*' route kurulduktan
//     sonra; route içinde harici isteğe continue/fallback/fetch → abort + BLOCK_BROWSER_CONTINUE; route'tan geçmeden
//     biten/kapanışta bekleyen harici istek → BLOCK_BROWSER_UNROUTED; gerçek sunucu adresli (serverAddr) harici yanıt →
//     BLOCK_BROWSER_NETWORK. Route ile yerelde sahte yanıtlanan harici istekler INFO_BROWSER_MOCKED_PROVIDER (ücretli/
//     kotalı sağlayıcı ya da onlara vekil kendi sunucumuz) / INFO_BROWSER_MOCKED_HOST olarak günlüğe girer.
//   - worker_threads.Worker, process.binding(ağ sarmalayıcıları), process.dlopen (yerel eklenti): reddedilir.
// "127.evil.invalid" gibi adlar yerel SAYILMAZ (eski /^127\./ açığı); 0.0.0.0 da izinli değildir.
// ESM adlandırılmış içe aktarmalar (import { lookup } from 'node:dns') syncBuiltinESMExports ile güncellenir.
// Her red NETGUARD_LOG'a "BLOCK_<tür> <hedef> pid=… <betik>" satırı yazar; node olmayan çocuk komutları "INFO_CHILD".
// Gizli bilgi yazılmaz: yalnız ana makine adı / komutun ilk sözcüğü günlüğe girer, URL yolu/sorgusu/argümanlar girmez.
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import wt from 'node:worker_threads';
import Module, { syncBuiltinESMExports } from 'node:module';

export const GUARD_URL = import.meta.url.split('?')[0];
export const MARK = Symbol.for('evrf.netguard.wrapped');
const LOG = process.env.NETGUARD_LOG || '';
const STATE = (globalThis[Symbol.for('evrf.netguard')] ??= { installs: 0, blocks: [], children: [] });
STATE.installs++;

const LOOP = new net.BlockList();
LOOP.addSubnet('127.0.0.0', 8, 'ipv4');
LOOP.addAddress('::1', 'ipv6');
LOOP.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

export function isLoopbackHost(h) {
  if (h === undefined || h === null || h === '') return true; // Node varsayılanı: localhost
  let s = String(h).trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (s === 'localhost') return true;
  const v = net.isIP(s);
  if (v === 4) return LOOP.check(s, 'ipv4');
  if (v === 6) return LOOP.check(s, 'ipv6');
  return false;
}
const allLoopback = (addr) => Array.isArray(addr)
  ? addr.length > 0 && addr.every((a) => isLoopbackHost(typeof a === 'string' ? a : a?.address))
  : typeof addr === 'string' && net.isIP(addr) !== 0 && isLoopbackHost(addr);

function info(kind, target) {
  const line = `INFO_${kind} ${String(target)} pid=${process.pid} ${process.argv[1] || ''}`;
  STATE.children.push(line);
  write(line);
}
function write(line) { if (LOG) { try { fs.appendFileSync(LOG, line + '\n'); } catch { /* günlük yazılamazsa red yine geçerli */ } } }
function note(kind, target) {
  const line = `BLOCK_${kind} ${String(target)} pid=${process.pid} ${process.argv[1] || ''}`;
  STATE.blocks.push(line);
  write(line);
}
function blocked(kind, target, code = 'ECONNREFUSED') {
  note(kind, target);
  const e = new Error(`netguard: ${kind} blocked ${target}`);
  e.code = code; e.netguard = true;
  return e;
}
const mark = (fn) => { fn[MARK] = true; return fn; };
const lastFn = (args) => { for (let i = args.length - 1; i >= 0; i--) if (typeof args[i] === 'function') return args[i]; return undefined; };

// ---- net (tls/http/https/http2/fetch/undici bunun üzerinden bağlanır) ----
function guardLookupOption(lookup) {
  if (lookup[MARK]) return lookup;
  return mark(function guardedLookupOption(host, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (!isLoopbackHost(host)) return process.nextTick(cb, blocked('DNS', `lookup-option(${host})`, 'ENOTFOUND'));
    return lookup.call(this, host, opts, (err, address, family) => {
      if (!err && !allLoopback(address)) return cb(blocked('DNS_RESULT', `lookup-option(${host})`, 'ENOTFOUND'));
      cb(err, address, family);
    });
  });
}
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = mark(function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  let host; let pipe = false;
  if (o && typeof o === 'object') {
    if (o.path) pipe = true;
    host = o.host ?? o.hostname;
    if (!pipe && typeof o.lookup === 'function') o.lookup = guardLookupOption(o.lookup);
  } else if (typeof o === 'string' && Number.isNaN(Number(o))) {
    pipe = true; // connect(path): yerel IPC
  } else {
    host = typeof args[1] === 'string' ? args[1] : undefined;
  }
  if (!pipe && !isLoopbackHost(host)) {
    const err = blocked('SOCKET', host);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return origConnect.apply(this, args);
});

// ---- dns ----
function wrapLookup(orig, label) {
  return mark(function lookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = undefined; }
    if (!isLoopbackHost(hostname)) {
      const e = blocked('DNS', `${label}(${hostname})`, 'ENOTFOUND');
      if (typeof callback === 'function') { process.nextTick(callback, e); return {}; }
      throw e;
    }
    if (typeof callback !== 'function') return orig.call(this, hostname, options, callback);
    const cb = (err, address, family) => {
      if (!err && !allLoopback(address)) return callback(blocked('DNS_RESULT', `${label}(${hostname})`, 'ENOTFOUND'));
      callback(err, address, family);
    };
    return options === undefined ? orig.call(this, hostname, cb) : orig.call(this, hostname, options, cb);
  });
}
function wrapLookupPromise(orig, label) {
  return mark(async function lookup(hostname, options) {
    if (!isLoopbackHost(hostname)) throw blocked('DNS', `${label}(${hostname})`, 'ENOTFOUND');
    const r = await orig.call(this, hostname, options);
    const addr = Array.isArray(r) ? r : r?.address;
    if (!allLoopback(addr)) throw blocked('DNS_RESULT', `${label}(${hostname})`, 'ENOTFOUND');
    return r;
  });
}
const RESOLVE_RE = /^(resolve|reverse|lookupService)/;
function blockResolvers(obj, label, promise) {
  for (const k of Object.getOwnPropertyNames(obj)) {
    if (!RESOLVE_RE.test(k)) continue;
    const d = Object.getOwnPropertyDescriptor(obj, k);
    if (!d || typeof d.value !== 'function' || d.value[MARK]) continue;
    const fn = promise
      ? mark(async function (...a) { throw blocked('DNS', `${label}.${k}(${a[0]})`, 'ENOTFOUND'); })
      : mark(function (...a) {
        const e = blocked('DNS', `${label}.${k}(${a[0]})`, 'ENOTFOUND');
        const cb = lastFn(a);
        if (cb) { process.nextTick(cb, e); return {}; }
        throw e;
      });
    Object.defineProperty(obj, k, { ...d, value: fn });
  }
}
// Ek savunma: c-ares'e bir şekilde ulaşılırsa sorgu yalnız loopback'e gider. SARMADAN ÖNCE çağrılır: setServers
// Node içinde dışa aktarımları Resolver.prototype'tan yeniden bağlar (bindDefaultResolver).
try { dns.setServers(['127.0.0.1']); } catch { /* yoksay */ }
try { dns.promises.setServers(['127.0.0.1']); } catch { /* yoksay */ }
dns.lookup = wrapLookup(dns.lookup, 'dns.lookup');
dns.promises.lookup = wrapLookupPromise(dns.promises.lookup, 'dns.promises.lookup');
blockResolvers(dns, 'dns', false);
blockResolvers(dns.Resolver.prototype, 'dns.Resolver', false);
blockResolvers(dns.promises, 'dns.promises', true);
blockResolvers(dns.promises.Resolver.prototype, 'dns.promises.Resolver', true);

// ---- dgram (UDP) ----
{
  const S = dgram.Socket.prototype;
  const oSend = S.send, oConnect = S.connect;
  const fail = (sock, e, cb) => { if (cb) process.nextTick(cb, e); else process.nextTick(() => sock.emit('error', e)); };
  S.send = mark(function send(msg, ...rest) {
    const addr = rest.find((a) => typeof a === 'string');
    if (addr !== undefined && !isLoopbackHost(addr)) return fail(this, blocked('UDP', addr), lastFn(rest));
    return oSend.call(this, msg, ...rest);
  });
  S.connect = mark(function connect(port, address, cb) {
    const addr = typeof address === 'string' ? address : undefined;
    if (addr !== undefined && !isLoopbackHost(addr)) return fail(this, blocked('UDP', addr), lastFn([address, cb]));
    return oConnect.apply(this, arguments);
  });
  for (const k of ['addMembership', 'addSourceSpecificMembership']) {
    if (typeof S[k] !== 'function') continue;
    S[k] = mark(function (...a) { throw blocked('UDP', `${k}(${a[a.length - 1] ?? a[0]})`); });
  }
}

// ---- fetch ----
if (typeof globalThis.fetch === 'function') {
  const oFetch = globalThis.fetch;
  globalThis.fetch = mark(function fetch(input, init) {
    let u;
    try { u = new URL(typeof input === 'string' ? input : (input?.url ?? String(input))); } catch { return oFetch.call(this, input, init); }
    if (!isLoopbackHost(u.hostname)) return Promise.reject(new TypeError('fetch failed', { cause: blocked('FETCH', u.hostname) }));
    return oFetch.call(this, input, init);
  });
}

// ---- Playwright tarayıcısı: YALNIZ BROWSER_SCRIPTS (kullanıcı kararı 2026-11-16, köprü 6883b3a8) ----
export const BROWSER_SCRIPTS = new Set(['test-station-card-layout.mjs']);
const BROWSER_EXE = { chromium: /^chromium-\d+[\\/]chrome-win64[\\/]chrome\.exe$/i, webkit: /^webkit-\d+[\\/]Playwright\.exe$/i };
const BROWSER_FORBID_ARG = /^--(remote-debugging-port|remote-debugging-address|proxy-server|proxy-pac-url|proxy-auto-detect|load-extension|host-rules)(=|$)/i;
// Ücretli/kotalı sağlayıcılar + bunlara vekil olan kendi sunucumuz (evcopilot.duckdns.org).
const PROVIDER_HOST = /(^|\.)(tomtom\.com|mapbox\.com|googleapis\.com|google\.com|hereapi\.com|here\.com|veriapi\.pro|iternio\.com|openchargemap\.io|duckdns\.org)$/i;
export const isProviderHost = (h) => PROVIDER_HOST.test(String(h ?? '').trim().toLowerCase().replace(/\.$/, ''));
const hostOf = (u) => { try { return new URL(String(u)).hostname; } catch { return '?'; } };
export function isLocalUrl(u) {
  let x; try { x = new URL(String(u)); } catch { return false; }
  if (['data:', 'blob:', 'about:'].includes(x.protocol)) return true;
  return ['http:', 'https:', 'ws:', 'wss:'].includes(x.protocol) && isLoopbackHost(x.hostname);
}
// Tarayıcı çocuk süreci izni: betik + yol + bayrak denetimi; ayrıca Playwright bu engelleyiciyle sarılmış olmalı.
export function browserChildVerdict(file, args, script, pwGuarded = STATE.pwGuarded === true) {
  if (!BROWSER_SCRIPTS.has(path.basename(String(script || '')))) return { ok: false, why: 'script' };
  const la = process.env.LOCALAPPDATA;
  if (!la) return { ok: false, why: 'path' };
  const rel = path.relative(path.join(la, 'ms-playwright'), path.resolve(String(file)));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, why: 'path' };
  const kind = Object.keys(BROWSER_EXE).find((k) => BROWSER_EXE[k].test(rel));
  if (!kind) return { ok: false, why: 'exe' };
  const a = (Array.isArray(args) ? args : []).map(String);
  if (a.some((x) => BROWSER_FORBID_ARG.test(x))) return { ok: false, why: 'arg' };
  if (!a.some((x) => /^--headless(=|$)/.test(x))) return { ok: false, why: 'headless' };
  const need = kind === 'chromium' ? ['--disable-background-networking', '--remote-debugging-pipe'] : ['--inspector-pipe'];
  if (!need.every((f) => a.includes(f))) return { ok: false, why: 'flags' };
  if (!pwGuarded) return { ok: false, why: 'unguarded' };
  return { ok: true, kind, flags: ['headless', ...need.map((f) => f.slice(2))] };
}
const deny = (kind, target) => { throw blocked(kind, target, 'EACCES'); };
function wrapRouteHandler(handler, kind, routed) {
  if (typeof handler !== 'function') return handler;
  return function guardedRouteHandler(route, request) {
    const req = route.request();
    routed.add(req);
    if (!isLocalUrl(req.url())) {
      const h = hostOf(req.url());
      for (const k of ['continue', 'fallback', 'fetch']) {
        if (typeof route[k] !== 'function') continue;
        route[k] = function () { note('BROWSER_CONTINUE', `${kind} ${h} via=${k}`); return route.abort('blockedbyclient'); };
      }
    }
    return handler.call(this, route, request);
  };
}
const isCatchAll = (u) => u === '**/*' || u === '**';
function guardContext(ctx, kind) {
  const routed = new WeakSet();
  let ctxAll = false;
  const pending = new Set();
  ctx.on('request', (req) => { if (!isLocalUrl(req.url())) pending.add(req); });
  // Harici istek ancak route ile yakalanıp yerelde yanıtlandıysa (fulfill → serverAddr null) ya da iptal edildiyse kabul.
  const done = async (req, failed) => {
    if (!pending.delete(req)) return;
    const h = hostOf(req.url());
    const tag = isProviderHost(h) ? 'PROVIDER' : 'HOST';
    if (!routed.has(req)) return note('BROWSER_UNROUTED', `${kind} ${h} ${tag}`);
    let addr = null;
    if (!failed) { try { addr = await (await req.response())?.serverAddr(); } catch { addr = null; } }
    if (addr) return note('BROWSER_NETWORK', `${kind} ${h} ${tag}`);
    info(`BROWSER_MOCKED_${tag}`, `${kind} ${h}`);
  };
  ctx.on('requestfinished', (req) => done(req, false));
  ctx.on('requestfailed', (req) => done(req, true));
  const oClose = ctx.close;
  ctx.close = mark(async function close(...a) {
    const r = await oClose.apply(this, a);
    for (const req of pending) if (!routed.has(req)) note('BROWSER_UNROUTED', `${kind} ${hostOf(req.url())} pending`);
    pending.clear();
    return r;
  });
  const oCtxRoute = ctx.route;
  ctx.route = mark(function route(url, handler, opts) { if (isCatchAll(url)) ctxAll = true; return oCtxRoute.call(this, url, wrapRouteHandler(handler, kind, routed), opts); });
  const oNewPage = ctx.newPage;
  ctx.newPage = mark(async function newPage(...a) {
    const p = await oNewPage.apply(this, a);
    let pageAll = false;
    const oRoute = p.route, oGoto = p.goto;
    p.route = mark(function route(url, handler, opts) { if (isCatchAll(url)) pageAll = true; return oRoute.call(this, url, wrapRouteHandler(handler, kind, routed), opts); });
    p.goto = mark(async function goto(url, o) {
      if (!isLocalUrl(url)) deny('BROWSER_GOTO', `${kind} ${hostOf(url)}`);
      if (!pageAll && !ctxAll) deny('BROWSER_NOROUTE', `${kind} goto-before-route`);
      return oGoto.call(this, url, o);
    });
    return p;
  });
  return ctx;
}
export function guardPlaywright(pw) {
  if (!pw || typeof pw !== 'object' || pw[MARK]) return pw;
  for (const kind of ['chromium', 'webkit', 'firefox']) {
    const bt = pw[kind];
    if (!bt || typeof bt.launch !== 'function') continue;
    const oLaunch = bt.launch;
    bt.launch = mark(async function launch(opts = {}) {
      const bad = Object.keys(opts ?? {}).filter((k) => !['executablePath', 'headless', 'timeout'].includes(k));
      if (opts?.headless === false) bad.push('headless=false');
      if (bad.length) deny('BROWSER_OPT', `${kind} launch(${bad.join(',')})`);
      const b = await oLaunch.call(this, opts);
      const oNewContext = b.newContext;
      b.newContext = mark(async function newContext(o = {}) {
        if (o?.proxy) deny('BROWSER_OPT', `${kind} newContext(proxy)`);
        if (o?.serviceWorkers !== 'block') deny('BROWSER_OPT', `${kind} newContext(serviceWorkers!=block)`);
        return guardContext(await oNewContext.call(this, o), kind);
      });
      b.newPage = mark(async function newPage() { deny('BROWSER_OPT', `${kind} browser.newPage`); });
      return b;
    });
    for (const k of ['launchPersistentContext', 'launchServer', 'connect', 'connectOverCDP']) {
      if (typeof bt[k] === 'function') bt[k] = mark(async function () { deny('BROWSER_OPT', `${kind}.${k}`); });
    }
  }
  pw[MARK] = true;
  STATE.pwGuarded = true;
  return pw;
}
{
  const oLoad = Module._load;
  if (typeof oLoad === 'function' && !oLoad[MARK]) {
    Module._load = mark(function _load(request, ...rest) {
      const r = oLoad.call(this, request, ...rest);
      if (/playwright/i.test(String(request)) && r && typeof r.chromium?.launch === 'function') return guardPlaywright(r);
      return r;
    });
  }
}

// ---- child_process: çocuğa engelleyiciyi enjekte et ----
export function guardedEnv(env) {
  const out = { ...(env ?? process.env) };
  const key = Object.keys(out).find((k) => k.toUpperCase() === 'NODE_OPTIONS') ?? 'NODE_OPTIONS';
  const cur = String(out[key] ?? '');
  if (!cur.includes(GUARD_URL)) out[key] = (cur ? cur + ' ' : '') + `--import=${GUARD_URL}`;
  if (LOG && !out.NETGUARD_LOG) out.NETGUARD_LOG = LOG;
  return out;
}
// İzinli node dışı çocuklar: git (yalnız `git status` — test-package-parity), icacls (yerel ACL — server/totp-setup.mjs).
const CHILD_ALLOW = /^(git|icacls)(\.exe)?$/i;
const isNodeCmd = (c) => c === process.execPath || /^node(\.exe)?$/i.test(path.basename(c));
for (const [name, hasArgs] of [['spawn', true], ['spawnSync', true], ['execFile', true], ['execFileSync', true], ['fork', true], ['exec', false], ['execSync', false]]) {
  const orig = cp[name];
  if (typeof orig !== 'function' || orig[MARK]) continue;
  cp[name] = mark(function (...a) {
    const p = hasArgs && (Array.isArray(a[1]) || (a[1] === null && a.length > 2)) ? 2 : 1;
    const o = a[p];
    if (o && typeof o === 'object' && !Array.isArray(o)) a[p] = { ...o, env: guardedEnv(o.env) };
    else if (o === undefined || o === null) a.splice(p, 1, { env: guardedEnv() });
    else if (typeof o === 'function') a.splice(p, 0, { env: guardedEnv() });
    // exec/execSync kabuk komut dizesi alır (ilk sözcük); diğerlerinde a[0] boşluk içerebilen dosya yoludur.
    const first = hasArgs ? String(a[0] ?? '') : String(a[0] ?? '').trim().split(/\s+/)[0].replace(/^["']|["']$/g, '');
    if (name !== 'fork' && !isNodeCmd(first)) {
      const base = path.basename(first);
      // Node dışı süreç bu engelleyiciyle korunamaz (ör. Playwright'ın başlattığı chrome.exe / Playwright.exe kendi ağ
      // yığınını kullanır). Yalnız ağsız yerel araçlar izinli; diğerleri fail-closed reddedilir.
      const bv = !CHILD_ALLOW.test(base) && name === 'spawn'
        ? browserChildVerdict(first, Array.isArray(a[1]) ? a[1] : [], process.argv[1]) : null;
      if (bv?.ok) {
        info('BROWSER', `${bv.kind} ${base} flags=${bv.flags.join(',')}`);
        return orig.apply(this, a);
      }
      if (!CHILD_ALLOW.test(base)) {
        const why = bv && bv.why !== 'script' ? ` reason=${bv.why}` : '';
        const e = blocked('CHILD', `${base} via=${name}${why}`, 'EACCES');
        if (name.endsWith('Sync')) throw e;
        const cb = lastFn(a);
        if (cb && (name === 'exec' || name === 'execFile')) { process.nextTick(cb, e); return undefined; }
        throw e;
      }
      const line = `INFO_CHILD ${base} via=${name} pid=${process.pid} ${process.argv[1] || ''}`;
      STATE.children.push(line); write(line);
    }
    return orig.apply(this, a);
  });
}

// ---- worker / ham bağlamalar / yerel eklenti ----
{
  const OW = wt.Worker;
  if (!OW[MARK]) {
    const GuardedWorker = class Worker extends OW {
      constructor(file) { throw blocked('WORKER', String(file).slice(0, 120)); super(file); } // eslint-disable-line no-unreachable
    };
    GuardedWorker[MARK] = true;
    wt.Worker = GuardedWorker;
  }
  const NET_BINDINGS = /^(tcp_wrap|udp_wrap|cares_wrap|pipe_wrap|tls_wrap|stream_wrap|js_stream)$/;
  const oBinding = process.binding;
  if (typeof oBinding === 'function') {
    process.binding = mark(function binding(name) { if (NET_BINDINGS.test(String(name))) throw blocked('BINDING', name); return oBinding.call(this, name); });
  }
  if (typeof process.dlopen === 'function') {
    process.dlopen = mark(function dlopen(_m, file) { throw blocked('DLOPEN', path.basename(String(file))); });
  }
}

syncBuiltinESMExports();
