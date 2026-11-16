// YALNIZ KAPALI CİHAZ TESTİ: `build-beta.mjs --free-only` çıktısını yerelde sunan küçük statik sunucu (yalnız Node yerleşik modülleri).
// Kullanım (Android, USB + adb reverse):   node scripts/serve-local-test.mjs <çıktı-klasörü>            → http://127.0.0.1:8080
//   sonra telefonda: adb reverse tcp:8080 tcp:8080  →  Chrome: http://localhost:8080   (localhost güvenli bağlam: konum/kamera/SW çalışır)
// Kullanım (iOS, aynı Wi-Fi, HTTPS zorunlu):
//   node scripts/serve-local-test.mjs <çıktı-klasörü> --https --cert <cert.pem> --key <key.pem> --host <bilgisayarın-LAN-IP'si> [--port 8443]
// Fail-closed: klasörde FREE-ONLY-LOCAL-TEST.txt yoksa (yani --free-only derlemesi değilse) sunmaz; --host verilmezse yalnız 127.0.0.1;
// 0.0.0.0 reddedilir; klasör dışına çıkan yol (../) 403. Ağa hiçbir istek atmaz, hiçbir yere yayın yapmaz, dosya yazmaz.
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip', '.traineddata': 'application/octet-stream', '.woff2': 'font/woff2' };

export function parseArgs(argv) {
  const o = { dir: '', https: false, cert: '', key: '', host: '127.0.0.1', port: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--https') o.https = true;
    else if (a === '--cert' || a === '--key' || a === '--host' || a === '--port') { const v = argv[++i]; if (v == null) throw new Error(a + ' değeri eksik'); o[a.slice(2)] = a === '--port' ? Number(v) : v; }
    else if (a.startsWith('--')) throw new Error('Bilinmeyen bayrak: ' + a);
    else if (!o.dir) o.dir = a;
    else throw new Error('Fazla bağımsız değişken: ' + a);
  }
  if (!o.dir) throw new Error('Sunulacak klasör verilmeli (build-beta.mjs --free-only çıktısı)');
  if (o.host === '0.0.0.0' || o.host === '::') throw new Error('Tüm arayüzlere bağlanma reddedildi; --host ile tek LAN IP ver');
  if (o.https && (!o.cert || !o.key)) throw new Error('--https için --cert ve --key gerekli');
  if (!o.port) o.port = o.https ? 8443 : 8080;
  if (!Number.isInteger(o.port) || o.port < 1024 || o.port > 65535) throw new Error('Geçersiz port: ' + o.port);
  return o;
}

export function startServer(o) {
  const root = realpathSync(resolve(o.dir));
  if (!existsSync(join(root, 'FREE-ONLY-LOCAL-TEST.txt'))) throw new Error('Klasör --free-only derlemesi değil (FREE-ONLY-LOCAL-TEST.txt yok): ' + root);
  const handler = (req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let file = resolve(join(root, p));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Yok'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  };
  const server = o.https ? httpsServer({ cert: readFileSync(o.cert), key: readFileSync(o.key) }, handler) : httpServer(handler);
  return new Promise((ok, bad) => { server.once('error', bad); server.listen(o.port, o.host, () => ok(server)); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const o = parseArgs(process.argv.slice(2));
  const server = await startServer(o);
  const { port } = server.address();
  console.log(`Yalnız ücretsiz yerel test derlemesi sunuluyor (YAYIN DEĞİL): ${o.https ? 'https' : 'http'}://${o.host}:${port}/`);
  if (!o.https) console.log(`Android: adb reverse tcp:${port} tcp:${port}  → telefonda http://localhost:${port}/`);
  console.log('Durdurmak için Ctrl+C.');
}
