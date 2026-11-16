// YALNIZ TEST: scripts/netguard.mjs öz-sınaması. Gerçek DNS/ağ denemesi YAPMAZ:
//  1) Engelleyici yüklenmeden ÖNCE tüm ağ uçları (Socket.connect, dns.*, dgram, fetch, child_process, Worker,
//     process.binding/dlopen) hiçbir zaman ağa çıkmayan "tuzak" (tripwire) işlevlerle değiştirilir.
//  2) Engelleyici bu tuzakların ÜSTÜNE kurulur (?selftest ile yeni modül örneği).
//  3) Sentetik .invalid / RFC 5737 (192.0.2.x) hedefleriyle her yol denenir: engelleyici reddetmeli VE alttaki tuzak
//     hiç çağrılmamalıdır (= gerçek ağa inecek çağrı 0). Loopback kontrolleri tuzağa ulaşmalıdır (sınama boş değil).
//  4) Gerçek alt süreç ön denetimi: engelleyici NODE_OPTIONS ile yüklenmiş çocuk ve ortamı PATH/SystemRoot'a
//     indirilmiş torun süreçte tüm uçların sarılı olduğu denetlenir; bu süreçler hiçbir ağ çağrısı yapmaz.
// Kullanım: node scripts/test-netguard.mjs
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dns from 'node:dns';
import dgram from 'node:dgram';
import cp from 'node:child_process';
import wt from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { lookup as namedLookup, resolve4 as namedResolve4 } from 'node:dns';
import { resolveTxt as namedPResolveTxt } from 'node:dns/promises';
import { connect as namedConnect } from 'node:net';
import { spawnSync as namedSpawnSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const GUARD_FILE = new URL('./netguard.mjs', import.meta.url);
const GUARD_URL = GUARD_FILE.href;
const MARK = Symbol.for('evrf.netguard.wrapped');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evrf-netguard-selftest-'));
const LOG = path.join(dir, 'blocked.log');
fs.writeFileSync(LOG, '');

try {
  // ---- 4) Gerçek alt süreç ön denetimi (tuzaklardan önce; ağ çağrısı yok) ----
  {
    const PROBE = `
      import net from 'node:net'; import dns from 'node:dns'; import dgram from 'node:dgram';
      import cp from 'node:child_process'; import wt from 'node:worker_threads';
      const M = Symbol.for('evrf.netguard.wrapped');
      const pts = { connect: net.Socket.prototype.connect, lookup: dns.lookup, plookup: dns.promises.lookup,
        resolve4: dns.resolve4, resolveAny: dns.resolveAny, reverse: dns.reverse, lookupService: dns.lookupService,
        presolve4: dns.promises.resolve4, Rresolve4: dns.Resolver.prototype.resolve4,
        PRresolve4: dns.promises.Resolver.prototype.resolve4, udpSend: dgram.Socket.prototype.send,
        udpConnect: dgram.Socket.prototype.connect, fetch: globalThis.fetch, spawn: cp.spawn, spawnSync: cp.spawnSync,
        execFileSync: cp.execFileSync, Worker: wt.Worker };
      const miss = Object.entries(pts).filter(([, f]) => !f || !f[M]).map(([k]) => k);
      let grand = null;
      if (process.env.PROBE_DEPTH === '1') {
        const r = cp.spawnSync(process.execPath, ['--input-type=module', '-e', process.env.PROBE_CODE],
          { env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' }, encoding: 'utf8' });
        try { grand = JSON.parse(r.stdout.trim()); } catch { grand = { err: (r.stdout + r.stderr).slice(0, 400) }; }
      }
      console.log(JSON.stringify({ installs: globalThis[Symbol.for('evrf.netguard')]?.installs ?? 0, miss,
        log: !!process.env.NETGUARD_LOG, grand }));`;
    const r = cp.spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', PROBE_DEPTH: '1', PROBE_CODE: PROBE,
        NODE_OPTIONS: `--import=${GUARD_URL}`, NETGUARD_LOG: LOG },
    });
    let j = null; try { j = JSON.parse(r.stdout.trim()); } catch { /* aşağıda FAIL */ }
    ok('çocuk süreç: engelleyici NODE_OPTIONS ile yüklü', j?.installs >= 1, (r.stdout + r.stderr).slice(0, 400));
    ok('çocuk süreç: tüm ağ uçları sarılı', Array.isArray(j?.miss) && j.miss.length === 0, JSON.stringify(j?.miss));
    ok('torun (env PATH/SystemRoot\'a indirilmiş): engelleyici enjekte edildi', j?.grand?.installs >= 1, JSON.stringify(j?.grand));
    ok('torun: tüm ağ uçları sarılı', Array.isArray(j?.grand?.miss) && j.grand.miss.length === 0, JSON.stringify(j?.grand));
    ok('torun: NETGUARD_LOG aktarıldı', j?.grand?.log === true);
    ok('ön denetim süreçleri hiç red üretmedi (ağ denemesi yok)', fs.readFileSync(LOG, 'utf8') === '', fs.readFileSync(LOG, 'utf8').slice(0, 600));
  }

  // ---- 1) Tuzak katmanı: hiçbir işlev gerçek ağa inmez ----
  const TRIP = { net: [], cp: [] };
  const tnet = (name) => TRIP.net.push(name);
  const dnsAnswer = { v: '127.0.0.1' };
  net.Socket.prototype.connect = function (...a) { tnet('socket.connect'); TRIP.lastConnectArgs = a; return this; };
  dns.lookup = function (h, o, cb) { tnet('dns.lookup'); cb = typeof o === 'function' ? o : cb; process.nextTick(cb, null, dnsAnswer.v, 4); return {}; };
  dns.promises.lookup = async function () { tnet('dns.promises.lookup'); return { address: dnsAnswer.v, family: 4 }; };
  const RES = /^(resolve|reverse|lookupService)/;
  for (const [obj, prom] of [[dns, false], [dns.Resolver.prototype, false], [dns.promises, true], [dns.promises.Resolver.prototype, true]]) {
    for (const k of Object.getOwnPropertyNames(obj)) {
      if (!RES.test(k)) continue;
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (!d || typeof d.value !== 'function') continue;
      const fn = prom
        ? async function () { tnet('dns.' + k); throw new Error('TRIP'); }
        : function (...a) { tnet('dns.' + k); const cb = a.findLast((x) => typeof x === 'function'); if (cb) process.nextTick(cb, new Error('TRIP')); return {}; };
      Object.defineProperty(obj, k, { ...d, value: fn });
    }
  }
  for (const k of ['send', 'connect', 'addMembership', 'addSourceSpecificMembership']) {
    dgram.Socket.prototype[k] = function () { tnet('udp.' + k); };
  }
  globalThis.fetch = async function () { tnet('fetch'); return new Response('trip'); };
  for (const k of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync']) {
    cp[k] = function (...a) { TRIP.cp.push({ k, a }); return k.endsWith('Sync') ? { status: 0, stdout: '', stderr: '' } : { pid: 0, on() { return this; } }; };
  }
  wt.Worker = class { constructor() { tnet('worker'); } };
  process.binding = function () { tnet('binding'); return {}; };
  process.dlopen = function () { tnet('dlopen'); };
  syncBuiltinESMExports();

  // ---- 2) Engelleyiciyi tuzakların üstüne kur ----
  const prevLog = process.env.NETGUARD_LOG;
  process.env.NETGUARD_LOG = LOG;
  const G = await import(GUARD_URL + '?selftest=' + Date.now());
  if (prevLog === undefined) delete process.env.NETGUARD_LOG; else process.env.NETGUARD_LOG = prevLog;

  const isNg = (e) => !!(e && (e.netguard || e.cause?.netguard));
  const errOf = (em, ms = 3000) => new Promise((res) => { const t = setTimeout(() => res(null), ms); em.once('error', (e) => { clearTimeout(t); res(e); }); });
  const rej = (p) => Promise.resolve().then(() => p).then(() => null, (e) => e);
  const cbErr = (fn) => new Promise((res) => { try { fn((e) => res(e)); } catch (e) { res(e); } });
  async function blockedVec(name, run) {
    const before = TRIP.net.length;
    let e; try { e = await run(); } catch (x) { e = x; }
    ok(`${name}: reddedildi`, isNg(e), String(e?.message || e));
    ok(`${name}: alt katmana (gerçek ağa) inen çağrı 0`, TRIP.net.length === before, TRIP.net.slice(before).join(','));
  }

  // ---- isLoopbackHost ----
  for (const h of [undefined, '', 'localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '::ffff:127.0.0.1']) ok(`loopback sayılır: ${String(h)}`, G.isLoopbackHost(h) === true);
  for (const h of ['127.evil.invalid', '127.0.0.1.invalid', 'localhost.invalid', 'localhost.', '192.0.2.1', '0.0.0.0', '::', '::ffff:192.0.2.1', '2001:db8::1', 'ng.invalid', '10.0.0.1']) ok(`loopback SAYILMAZ: ${h}`, G.isLoopbackHost(h) === false);

  // ---- 3) Yerel olmayan her yol ----
  await blockedVec('fetch(string)', () => rej(globalThis.fetch('https://ng-fetch.invalid/x?k=1')));
  await blockedVec('fetch(URL)', () => rej(globalThis.fetch(new URL('https://ng-fetch-url.invalid/'))));
  await blockedVec('fetch(Request)', () => rej(globalThis.fetch(new Request('https://ng-fetch-req.invalid/'))));
  await blockedVec('net.connect(port, host)', () => errOf(net.connect(443, 'ng-net.invalid')));
  await blockedVec('net.connect({host})', () => errOf(net.connect({ host: 'ng-obj.invalid', port: 443 })));
  await blockedVec('net.createConnection(port, host)', () => errOf(net.createConnection(443, 'ng-cc.invalid')));
  await blockedVec('new Socket().connect(port, host)', () => errOf(new net.Socket().connect(443, 'ng-sock.invalid')));
  await blockedVec('ESM named connect', () => errOf(namedConnect(443, 'ng-named.invalid')));
  await blockedVec('net.connect IP 192.0.2.1', () => errOf(net.connect(443, '192.0.2.1')));
  await blockedVec('net.connect 127.evil.invalid (eski /^127\\./ açığı)', () => errOf(net.connect(443, '127.evil.invalid')));
  await blockedVec('net.connect ::ffff:192.0.2.1', () => errOf(net.connect({ host: '::ffff:192.0.2.1', port: 443 })));
  await blockedVec('net.connect 0.0.0.0', () => errOf(net.connect(443, '0.0.0.0')));
  await blockedVec('tls.connect(port, host)', () => errOf(tls.connect(443, 'ng-tls.invalid')));
  await blockedVec('tls.connect({host})', () => errOf(tls.connect({ host: 'ng-tls-obj.invalid', port: 443, servername: 'ng-tls-obj.invalid' })));
  await blockedVec('http.get', () => errOf(http.get('http://ng-http.invalid/')));
  await blockedVec('http.request({hostname})', () => { const r = http.request({ hostname: 'ng-http-opt.invalid', port: 80, path: '/' }); r.end(); return errOf(r); });
  await blockedVec('https.get', () => errOf(https.get('https://ng-https.invalid/')));
  await blockedVec('http2.connect', () => { const s = http2.connect('https://ng-h2.invalid'); return errOf(s).finally(() => s.destroy()); });
  await blockedVec('dns.lookup(cb)', () => cbErr((cb) => dns.lookup('ng-dns.invalid', cb)));
  await blockedVec('dns.lookup(opts, cb)', () => cbErr((cb) => dns.lookup('ng-dns2.invalid', { all: true }, cb)));
  await blockedVec('ESM named lookup', () => cbErr((cb) => namedLookup('ng-dns-named.invalid', cb)));
  await blockedVec('dns.promises.lookup', () => rej(dns.promises.lookup('ng-pdns.invalid')));
  for (const k of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveTxt', 'resolveSrv', 'resolveMx', 'resolveNs', 'resolveCname', 'resolveSoa']) {
    await blockedVec(`dns.${k}`, () => cbErr((cb) => dns[k]('ng-res.invalid', cb)));
    await blockedVec(`dns.promises.${k}`, () => rej(dns.promises[k]('ng-pres.invalid')));
    await blockedVec(`new dns.Resolver().${k}`, () => cbErr((cb) => new dns.Resolver()[k]('ng-rres.invalid', cb)));
    await blockedVec(`new dns.promises.Resolver().${k}`, () => rej(new dns.promises.Resolver()[k]('ng-prres.invalid')));
  }
  await blockedVec('dns.resolve4 localhost da (c-ares hep kapalı)', () => cbErr((cb) => dns.resolve4('localhost', cb)));
  await blockedVec('dns.reverse', () => cbErr((cb) => dns.reverse('192.0.2.1', cb)));
  await blockedVec('dns.promises.reverse', () => rej(dns.promises.reverse('192.0.2.1')));
  await blockedVec('dns.lookupService', () => cbErr((cb) => dns.lookupService('192.0.2.1', 443, cb)));
  await blockedVec('ESM named resolve4', () => cbErr((cb) => namedResolve4('ng-named-res.invalid', cb)));
  await blockedVec('ESM named dns/promises resolveTxt', () => rej(namedPResolveTxt('ng-named-pres.invalid')));
  {
    const u = dgram.createSocket('udp4');
    try {
      await blockedVec('dgram.send(host)', () => cbErr((cb) => u.send('x', 53, 'ng-udp.invalid', cb)));
      await blockedVec('dgram.send(offset,length,port,ip)', () => cbErr((cb) => u.send('xyz', 0, 3, 53, '192.0.2.53', cb)));
      await blockedVec('dgram.connect(host)', () => cbErr((cb) => u.connect(53, 'ng-udpc.invalid', cb)));
      await blockedVec('dgram.addMembership', () => rej((async () => u.addMembership('224.0.0.251'))()));
    } finally { u.close(); }
  }
  await blockedVec('worker_threads.Worker', () => rej((async () => new wt.Worker('data:,0'))()));
  await blockedVec('process.binding(tcp_wrap)', () => rej((async () => process.binding('tcp_wrap'))()));
  await blockedVec('process.binding(cares_wrap)', () => rej((async () => process.binding('cares_wrap'))()));
  await blockedVec('process.dlopen', () => rej((async () => process.dlopen({ exports: {} }, 'evil.node'))()));

  // localhost çözümü loopback değilse (ör. bozuk hosts) reddedilir — tuzak cevap verir, ağ yok.
  dnsAnswer.v = '192.0.2.9';
  {
    const e = await cbErr((cb) => dns.lookup('localhost', cb));
    ok('dns.lookup(localhost) → 192.0.2.9 sonucu reddedildi', isNg(e) && /DNS_RESULT/.test(fs.readFileSync(LOG, 'utf8')), String(e?.message || e));
    const e2 = await rej(dns.promises.lookup('localhost'));
    ok('dns.promises.lookup(localhost) → 192.0.2.9 sonucu reddedildi', isNg(e2), String(e2?.message || e2));
  }
  dnsAnswer.v = '127.0.0.1';
  // Özel lookup seçeneği localhost'u dış adrese çeviremez.
  {
    const s = net.connect({ host: 'localhost', port: 9, lookup: (h, o, cb) => cb(null, '192.0.2.10', 4) });
    const opts = Array.isArray(TRIP.lastConnectArgs?.[0]) ? TRIP.lastConnectArgs[0][0] : TRIP.lastConnectArgs?.[0];
    s.destroy();
    ok('özel lookup seçeneği sarıldı', !!opts?.lookup?.[MARK]);
    const e = await cbErr((cb) => opts.lookup('localhost', {}, cb));
    ok('özel lookup → 192.0.2.10 reddedildi', isNg(e), String(e?.message || e));
  }

  // ---- Loopback kontrolleri tuzağa ULAŞIR (sınama boş değil) ----
  {
    const b = TRIP.net.length;
    const s1 = net.connect(9, '127.0.0.1'); s1.destroy();
    const s2 = net.connect({ port: 9 }); s2.destroy();
    const s3 = net.connect({ host: '::1', port: 9 }); s3.destroy();
    await globalThis.fetch('http://127.0.0.1:9/');
    const e = await cbErr((cb) => dns.lookup('localhost', (err, a) => cb(err || (a === '127.0.0.1' ? null : new Error(a)))));
    const ipc = new net.Socket(); ipc.connect({ path: '\\\\.\\pipe\\evrf-netguard-selftest' }); ipc.destroy();
    ok('loopback socket/fetch/lookup/IPC tuzağa ulaştı (6 çağrı)', TRIP.net.length - b === 6 && e === null, TRIP.net.slice(b).join(','));
  }

  // ---- child_process: engelleyici çocuk ortamına enjekte edilir (tuzak; gerçek süreç yok) ----
  {
    TRIP.cp.length = 0;
    cp.spawnSync(process.execPath, ['x.mjs'], { env: { PATH: 'p' } });
    cp.spawn(process.execPath, ['x.mjs']);
    cp.execFile(process.execPath, () => {});
    cp.execFileSync(process.execPath, ['x.mjs'], { cwd: '.', env: { PATH: 'p', NODE_OPTIONS: '--no-warnings' } });
    cp.exec('node x.mjs');
    cp.execSync('git status', { env: { PATH: 'p' } });
    cp.fork('x.mjs');
    namedSpawnSync(process.execPath, ['y.mjs']);
    const envOf = (c) => c.a.find((x) => x && typeof x === 'object' && !Array.isArray(x))?.env;
    ok('child_process: 8 çağrı tuzağa ulaştı', TRIP.cp.length === 8, String(TRIP.cp.length));
    // Açık env verilen çağrılar (0: spawnSync, 3: execFileSync, 5: execSync) bu engelleyicinin günlüğünü alır;
    // env verilmeyenler process.env'i devralır — üstte zaten NETGUARD_LOG varsa (koşucu altında) o korunur.
    const EXPLICIT = new Set([0, 3, 5]);
    TRIP.cp.forEach((c, i) => {
      const env = envOf(c);
      const wantLog = EXPLICIT.has(i) ? LOG : (process.env.NETGUARD_LOG || LOG);
      ok(`child_process.${c.k}: NODE_OPTIONS --import=netguard`, String(env?.NODE_OPTIONS || '').includes(`--import=${GUARD_URL}`), JSON.stringify(env?.NODE_OPTIONS));
      ok(`child_process.${c.k}: NETGUARD_LOG aktarıldı`, !!env?.NETGUARD_LOG && env.NETGUARD_LOG === wantLog, String(env?.NETGUARD_LOG));
    });
    ok('mevcut NODE_OPTIONS korunur', String(envOf(TRIP.cp[3])?.NODE_OPTIONS).startsWith('--no-warnings '));
    ok('execFile geri çağrısı yerinde kalır', typeof TRIP.cp[2].a[2] === 'function');
    ok('env PATH kısıtı korunur (yalnız ekleme)', envOf(TRIP.cp[0])?.PATH === 'p');
    // Node dışı, ağ yığını korunamayan çocuklar (tarayıcı, curl…) reddedilir; tuzağa (gerçek süreç başlatmaya) inmez.
    const nCp = TRIP.cp.length;
    const tryCp = (fn) => { try { const r = fn(); return r; } catch (e) { return e; } };
    ok('spawn(chrome.exe) reddedildi', isNg(tryCp(() => cp.spawn('C:\\ms-playwright\\chromium\\chrome.exe', ['--headless']))));
    ok('spawn(Playwright.exe) reddedildi', isNg(tryCp(() => cp.spawn('C:\\ms-playwright\\webkit\\Playwright.exe', []))));
    ok('spawnSync(curl) reddedildi', isNg(tryCp(() => cp.spawnSync('curl', ['https://ng-curl.invalid/']))));
    ok('execSync(powershell …) reddedildi', isNg(tryCp(() => cp.execSync('powershell -c iwr https://ng-ps.invalid'))));
    ok('execFile(curl, cb) geri çağrıda reddedildi', isNg(await new Promise((res) => { const r = tryCp(() => cp.execFile('curl', ['x'], (e) => res(e))); if (r instanceof Error) res(r); })));
    ok('reddedilen çocuklar tuzağa inmedi (süreç başlatılmadı)', TRIP.cp.length === nCp, String(TRIP.cp.length - nCp));
    ok('node olmayan çocuk INFO_CHILD olarak günlüğe girer (argüman yazılmaz)', /INFO_CHILD git via=execSync/.test(fs.readFileSync(LOG, 'utf8')) && !/git status/.test(fs.readFileSync(LOG, 'utf8')));
  }

  // ---- Tarayıcı istisnası (yalnız test-station-card-layout.mjs; sahte yollar/nesneler, gerçek süreç/ağ yok) ----
  {
    const S = globalThis[Symbol.for('evrf.netguard')];
    const prevLA = process.env.LOCALAPPDATA;
    if (!prevLA) process.env.LOCALAPPDATA = path.join(dir, 'la');
    const MSP = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    const CHR = path.join(MSP, 'chromium-1234', 'chrome-win64', 'chrome.exe');
    const WK = path.join(MSP, 'webkit-2336', 'Playwright.exe');
    const CARD = 'C:\\x\\scripts\\test-station-card-layout.mjs';
    const CA = ['--disable-background-networking', '--headless', '--remote-debugging-pipe', '--no-startup-window'];
    const WA = ['--inspector-pipe', '--headless', '--no-startup-window'];
    const V = (f, a, s = CARD, g = true) => G.browserChildVerdict(f, a, s, g);
    ok('tarayıcı: kart testi + chromium + varsayılan bayraklar izinli', V(CHR, CA).ok === true && V(CHR, CA).kind === 'chromium');
    ok('tarayıcı: kart testi + webkit + varsayılan bayraklar izinli', V(WK, WA).ok === true && V(WK, WA).kind === 'webkit');
    ok('tarayıcı: başka betik reddedilir', V(CHR, CA, 'C:\\x\\scripts\\test-white-ui.mjs').why === 'script');
    ok('tarayıcı: betik adı öneki yetmez', V(CHR, CA, 'C:\\x\\test-station-card-layout.mjs.evil.mjs').why === 'script');
    ok('tarayıcı: Playwright sarılmadan reddedilir', V(CHR, CA, CARD, false).why === 'unguarded');
    ok('tarayıcı: --disable-background-networking yoksa reddedilir', V(CHR, CA.filter((x) => x !== '--disable-background-networking')).why === 'flags');
    ok('tarayıcı: pipe yerine port reddedilir', V(CHR, [...CA, '--remote-debugging-port=9222']).why === 'arg');
    ok('tarayıcı: --proxy-server reddedilir', V(CHR, [...CA, '--proxy-server=ng-proxy.invalid:1']).why === 'arg');
    ok('tarayıcı: --host-rules reddedilir', V(CHR, [...CA, '--host-rules=MAP * ng.invalid']).why === 'arg');
    ok('tarayıcı: headless değilse reddedilir', V(CHR, CA.filter((x) => x !== '--headless')).why === 'headless');
    ok('tarayıcı: webkit --inspector-pipe yoksa reddedilir', V(WK, ['--headless']).why === 'flags');
    ok('tarayıcı: ms-playwright dışı chrome.exe reddedilir', V('C:\\evil\\chrome.exe', CA).why === 'path');
    ok('tarayıcı: ".." ile kaçış reddedilir', V(path.join(MSP, '..', 'evil', 'chromium-1', 'chrome-win64', 'chrome.exe'), CA).why === 'path');
    ok('tarayıcı: firefox / başka exe reddedilir', V(path.join(MSP, 'firefox-1538', 'firefox', 'firefox.exe'), CA).why === 'exe');
    // child_process yolu: argv[1] kart testi + Playwright sarılı → tuzağa (süreç başlatmaya) iner; bayrak eksikse inmez.
    const prevArgv = process.argv[1], prevG = S.pwGuarded;
    process.argv[1] = CARD; S.pwGuarded = true;
    try {
      const n0 = TRIP.cp.length;
      cp.spawn(CHR, CA, {});
      ok('spawn(chrome.exe) kart testinde izinli → tuzağa indi', TRIP.cp.length === n0 + 1);
      ok('izinli tarayıcı INFO_BROWSER olarak günlüğe girer', /INFO_BROWSER chromium chrome\.exe flags=headless,disable-background-networking,remote-debugging-pipe/.test(fs.readFileSync(LOG, 'utf8')));
      const e = (() => { try { return cp.spawn(CHR, ['--headless', '--remote-debugging-pipe'], {}); } catch (x) { return x; } })();
      ok('kart testinde bile bayraksız chrome.exe reddedildi', isNg(e) && TRIP.cp.length === n0 + 1);
      const e2 = (() => { try { return cp.spawnSync(CHR, CA, {}); } catch (x) { return x; } })();
      ok('tarayıcı yalnız spawn ile (spawnSync reddedilir)', isNg(e2) && TRIP.cp.length === n0 + 1);
      S.pwGuarded = false;
      const e3 = (() => { try { return cp.spawn(CHR, CA, {}); } catch (x) { return x; } })();
      ok('Playwright sarılmamışsa kart testinde de reddedilir', isNg(e3) && /reason=unguarded/.test(fs.readFileSync(LOG, 'utf8')));
    } finally { process.argv[1] = prevArgv; S.pwGuarded = prevG; if (!prevLA) delete process.env.LOCALAPPDATA; }

    // Sağlayıcı / yerel URL sınıflaması (saf)
    for (const h of ['api.tomtom.com', 'api.mapbox.com', 'places.googleapis.com', 'www.google.com', 'router.hereapi.com', 'api.veriapi.pro', 'api.iternio.com', 'api.openchargemap.io', 'evcopilot.duckdns.org', 'API.TOMTOM.COM.']) ok(`sağlayıcı sayılır: ${h}`, G.isProviderHost(h) === true);
    for (const h of ['tiles.openfreemap.org', 'nottomtom.com', 'tomtom.com.ng.invalid', '127.0.0.1', '']) ok(`sağlayıcı SAYILMAZ: ${h || '(boş)'}`, G.isProviderHost(h) === false);
    for (const u of ['http://127.0.0.1:1/', 'http://localhost:1/x', 'blob:http://127.0.0.1:1/id', 'data:text/plain,x', 'about:blank']) ok(`yerel URL: ${u}`, G.isLocalUrl(u) === true);
    for (const u of ['https://api.tomtom.com/x', 'http://127.evil.invalid/', 'http://192.0.2.1/', 'ws://ng.invalid/', 'file:///C:/x', 'nonsense']) ok(`yerel SAYILMAZ: ${u}`, G.isLocalUrl(u) === false);

    // Sahte Playwright: Module._load kancası + launch/newContext/newPage/route/goto denetimi
    const tick = () => new Promise((r) => setImmediate(r));
    const calls = [];
    class Em { constructor() { this.l = {}; } on(e, f) { (this.l[e] ??= []).push(f); return this; } emit(e, ...a) { for (const f of this.l[e] || []) f(...a); } }
    const mkCtx = () => {
      const ctx = new Em(); ctx.routes = []; ctx.pages = [];
      ctx.route = function (u, h) { ctx.routes.push([u, h]); };
      ctx.close = async function () { calls.push('ctx.close'); };
      ctx.newPage = async function () { const p = { routes: [], route(u, h) { p.routes.push([u, h]); }, async goto(u) { calls.push('goto ' + u); return null; } }; ctx.pages.push(p); return p; };
      return ctx;
    };
    const mkBT = (kind) => ({
      async launch(o) { calls.push('launch ' + kind); return { async newContext() { calls.push('newContext'); return mkCtx(); }, async newPage() { calls.push('browser.newPage'); } }; },
      async launchPersistentContext() { calls.push('lpc'); }, async launchServer() { calls.push('ls'); }, async connect() { calls.push('connect'); }, async connectOverCDP() { calls.push('cdp'); },
    });
    const fdir = path.join(dir, 'node_modules', 'fake-playwright-core');
    fs.mkdirSync(fdir, { recursive: true });
    fs.writeFileSync(path.join(fdir, 'index.js'), 'module.exports = { chromium: {}, webkit: {} };');
    const req = (await import('node:module')).createRequire(path.join(dir, 'x.js'));
    ok('Module._load sarılı', !!(await import('node:module')).default._load[MARK]);
    const fake = req('fake-playwright-core');
    // Kanca yalnız launch işlevi olan dışa aktarımı sarar; burada henüz yok → sarılmaz. Gerçek biçimi elle kur ve sar.
    ok('launch işlevi olmayan modül sarılmaz', !fake[MARK]);
    fake.chromium = mkBT('chromium'); fake.webkit = mkBT('webkit');
    S.pwGuarded = false;
    const pw = G.guardPlaywright(fake);
    ok('guardPlaywright: işaretlendi ve pwGuarded=true', !!pw[MARK] && S.pwGuarded === true);
    S.pwGuarded = prevG;
    const rj = async (f) => { try { await f(); return null; } catch (e) { return e; } };
    for (const [name, o] of [['args', { executablePath: 'x', args: ['--x'] }], ['ignoreDefaultArgs', { ignoreDefaultArgs: true }], ['headless:false', { headless: false }], ['proxy', { proxy: { server: 'ng.invalid:1' } }], ['channel', { channel: 'chrome' }]]) {
      const n = calls.length;
      ok(`launch(${name}) reddedildi, alt launch çağrılmadı`, isNg(await rj(() => pw.chromium.launch(o))) && calls.length === n);
    }
    for (const k of ['launchPersistentContext', 'launchServer', 'connect', 'connectOverCDP']) {
      const n = calls.length;
      ok(`${k} reddedildi`, isNg(await rj(() => pw.webkit[k]('x'))) && calls.length === n);
    }
    const b = await pw.chromium.launch({ executablePath: 'x' });
    ok('launch({executablePath}) izinli', calls.at(-1) === 'launch chromium');
    ok('browser.newPage (örtük bağlam) reddedildi', isNg(await rj(() => b.newPage())) && calls.at(-1) === 'launch chromium');
    ok('newContext serviceWorkers verilmezse reddedildi', isNg(await rj(() => b.newContext({}))));
    ok('newContext proxy reddedildi', isNg(await rj(() => b.newContext({ serviceWorkers: 'block', proxy: { server: 'ng.invalid:1' } }))));
    const ctx = await b.newContext({ serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const ng = calls.length;
    ok('route kurulmadan goto reddedildi', isNg(await rj(() => p.goto('http://127.0.0.1:1/'))) && calls.length === ng);
    p.route('**/*', async (r) => {
      const u = r.request().url();
      if (u.startsWith('http://127.0.0.1:1/')) return r.continue();
      if (u.includes('/fetch')) return r.fetch();
      if (u.includes('/cont')) return r.continue();
      if (u.includes('/fb')) return r.fallback();
      return r.fulfill({ status: 404 });
    });
    ok('harici goto reddedildi', isNg(await rj(() => p.goto('https://ng-goto.invalid/'))) && calls.length === ng);
    await p.goto('http://127.0.0.1:1/');
    ok('route sonrası loopback goto izinli', calls.at(-1) === 'goto http://127.0.0.1:1/');
    const H = p.routes[0][1];
    const mkReq = (url, addr = null) => ({ url: () => url, response: async () => ({ serverAddr: async () => addr }) });
    const mkRoute = (rq) => { const r = { done: [], request: () => rq }; for (const k of ['continue', 'fallback', 'fetch', 'fulfill']) r[k] = async () => { r.done.push(k); }; r.abort = async (c) => { r.done.push('abort:' + c); }; return r; };
    const flow = async (url, { addr = null, route = true, failed = false } = {}) => {
      const rq = mkReq(url, addr); const r = mkRoute(rq);
      ctx.emit('request', rq);
      if (route) await H(r, rq);
      ctx.emit(failed ? 'requestfailed' : 'requestfinished', rq);
      await tick(); await tick();
      return r.done;
    };
    const logNow = () => fs.readFileSync(LOG, 'utf8');
    ok('loopback isteği continue edilir', (await flow('http://127.0.0.1:1/app.js')).join() === 'continue');
    ok('harici continue → abort + BLOCK_BROWSER_CONTINUE', (await flow('https://ng-cont.invalid/cont')).join() === 'abort:blockedbyclient' && /BLOCK_BROWSER_CONTINUE chromium ng-cont\.invalid via=continue/.test(logNow()));
    ok('harici fallback → abort', (await flow('https://ng-fb.invalid/fb')).join() === 'abort:blockedbyclient' && /via=fallback/.test(logNow()));
    ok('harici route.fetch → abort', (await flow('https://ng-fetch2.invalid/fetch')).join() === 'abort:blockedbyclient' && /via=fetch/.test(logNow()));
    ok('sağlayıcı isteği yakalanıp sahte yanıtlandı → INFO_BROWSER_MOCKED_PROVIDER, BLOCK yok', (await flow('https://api.tomtom.com/x?key=1')).join() === 'fulfill' && /INFO_BROWSER_MOCKED_PROVIDER chromium api\.tomtom\.com/.test(logNow()) && !/BLOCK_BROWSER_\w+ chromium api\.tomtom\.com/.test(logNow()));
    ok('sağlayıcı olmayan harici sahte yanıt → INFO_BROWSER_MOCKED_HOST', (await flow('https://ng-host.invalid/y')).join() === 'fulfill' && /INFO_BROWSER_MOCKED_HOST chromium ng-host\.invalid/.test(logNow()));
    await flow('https://ng-unrouted.invalid/z', { route: false });
    ok('route\'tan geçmeyen harici istek → BLOCK_BROWSER_UNROUTED', /BLOCK_BROWSER_UNROUTED chromium ng-unrouted\.invalid HOST/.test(logNow()));
    await flow('https://ng-net.invalid/n', { addr: { ipAddress: '192.0.2.7', port: 443 } });
    ok('gerçek sunucu adresli harici yanıt → BLOCK_BROWSER_NETWORK', /BLOCK_BROWSER_NETWORK chromium ng-net\.invalid HOST/.test(logNow()));
    ctx.emit('request', mkReq('https://ng-pending.invalid/p'));
    await ctx.close();
    ok('kapanışta bekleyen yakalanmamış istek → BLOCK_BROWSER_UNROUTED pending', /BLOCK_BROWSER_UNROUTED chromium ng-pending\.invalid pending/.test(logNow()) && calls.at(-1) === 'ctx.close');
    ok('günlükte URL sorgusu/yolu yok (key=1, /x)', !/key=1|api\.tomtom\.com\/x/.test(logNow()));
  }

  // ---- Günlük ve özet ----
  const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
  const blocks = lines.filter((l) => l.startsWith('BLOCK_'));
  const SYNTH = /\.invalid|192\.0\.2\.|0\.0\.0\.0|224\.0\.0\.251|tcp_wrap|cares_wrap|evil\.node|data:,0|localhost|^BLOCK_CHILD (chrome|Playwright|curl|powershell)|^BLOCK_BROWSER_(OPT|NOROUTE) /;
  ok('her red günlüğe yazıldı', blocks.length > 60, String(blocks.length));
  ok('günlükte yalnız sentetik hedefler (.invalid / 192.0.2.x / 0.0.0.0 / ::ffff:192.0.2.1 / ağ uçları)',
    blocks.every((l) => SYNTH.test(l)), blocks.find((l) => !SYNTH.test(l)) || '');
  ok('URL yolu/sorgusu günlüğe girmez', !lines.some((l) => l.includes('k=1') || l.includes('/x')));
  // Beklenen tuzak çağrıları: localhost-sonuç denetimi (2), özel lookup seçeneği bağlantısı (1), loopback kontrolleri (6).
  const EXPECTED = 'dns.lookup,dns.promises.lookup,socket.connect,socket.connect,socket.connect,socket.connect,fetch,dns.lookup,socket.connect';
  ok('tuzağa ulaşan ağ çağrıları yalnız loopback/sahte cevap kontrolleri (9)', TRIP.net.join(',') === EXPECTED, TRIP.net.join(','));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail) process.exit(1);
