// Android uygulamasının internetten kurulumu: /app kurulum sayfası ve /app/ev-copilot.apk indirme adresi.
// APK dosyası server/public/ içindedir (repoya girmez); `npm run apk` derleyip oraya koyar ve app.json yazar.
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createAppFiles({ dir, send }) {
  const apk = join(dir, 'ev-copilot.apk');
  const info = join(dir, 'app.json');
  const hits = new Map(); // adres → { saat, sayı }: indirme kötüye kullanımına karşı saatte en çok 20

  const meta = () => { try { return JSON.parse(readFileSync(info, 'utf8')); } catch { return null; } };
  const size = () => { try { return statSync(apk).size; } catch { return 0; } };
  const tooMany = (ip) => {
    const h = Math.floor(Date.now() / 3600e3);
    const e = hits.get(ip);
    if (!e || e.h !== h) { hits.set(ip, { h, n: 1 }); return false; }
    return ++e.n > 20;
  };
  setInterval(() => { const h = Math.floor(Date.now() / 3600e3); for (const [k, v] of hits) if (v.h < h) hits.delete(k); }, 3600e3).unref();

  const HEAD = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' };

  function page(res) {
    const m = meta();
    const ok = size() > 0;
    const mb = (size() / 1048576).toFixed(1);
    send(res, 200, `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EV Co-Pilot</title>`
      + `<style>body{font:16px system-ui,sans-serif;background:#0b0f14;color:#e8eef5;margin:0;padding:24px;display:grid;place-items:center;min-height:100vh}main{max-width:460px}h1{font-size:24px;margin:0 0 4px}p,li{color:#a9b6c6;line-height:1.55}ol{padding-left:20px}.btn{display:block;margin:18px 0;padding:16px 18px;border-radius:14px;background:#2ee6a6;color:#04281c;text-align:center;text-decoration:none;font-weight:700}.off{background:#2c3a49;color:#a9b6c6}small{color:#7d8da0}</style></head>`
      + `<body><main><h1>🔌 EV Co-Pilot</h1><p>Android uygulaması${m?.version ? ` · v${esc(m.version)}` : ''}${ok ? ` · ${mb} MB` : ''}. <small>Android app.</small></p>`
      + (ok ? `<a class="btn" href="/app/ev-copilot.apk" download>📥 APK'yı indir (Download APK)</a>` : `<div class="btn off">APK henüz yüklenmemiş (APK not uploaded yet)</div>`)
      + `<ol><li>İndirince dosyayı aç. Android "bu kaynaktan yüklemeye izin ver" derse izin ver, sonra <b>Yükle</b>'ye dokun. <small>(Open the file; allow installs from this source; tap Install.)</small></li>`
      + `<li>Play Protect uyarı verirse "Yine de yükle" de. Uygulama kendi imzalı sürümümüzdür. <small>(If Play Protect warns, choose Install anyway.)</small></li>`
      + `<li>Uygulamayı aç, <b>Daha Fazla › Hesap › Google ile giriş</b>. Giriş için davet linkine de ihtiyacın var; sana gönderilen linke bir kez dokun. <small>(Open the app, then More › Account › Sign in with Google. You need an invite link.)</small></li></ol>`
      + `<p><small>Güncelleme: uygulama arayüzü kendiliğinden güncellenir. Bu sayfadan yeniden kurmak yalnızca Android sürümü değiştiğinde (izin ya da eklenti) gerekir; hesabın ve ayarların korunur. İlk açılış internet ister, sonrası internetsiz de açılır.</small></p></main></body></html>`, HEAD);
  }

  /** true dönerse yanıt verildi. */
  function handle(req, res, url, ip) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (url.pathname === '/app' || url.pathname === '/app/') { page(res); return true; }
    if (url.pathname === '/app/ev-copilot.apk') {
      const n = size();
      if (!n) { send(res, 404, 'APK yok', { 'Content-Type': 'text/plain; charset=utf-8' }); return true; }
      if (req.method === 'GET' && tooMany(ip)) { send(res, 429, 'Çok fazla indirme, sonra dene', { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '3600' }); return true; }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="EV-Co-Pilot.apk"',
        'Content-Length': n, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end(); else createReadStream(apk).pipe(res);
      return true;
    }
    if (url.pathname === '/app/latest.json') { send(res, 200, JSON.stringify({ ...(meta() || {}), size: size() }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }); return true; }
    return false;
  }
  return { handle };
}
