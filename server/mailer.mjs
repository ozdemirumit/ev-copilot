// Küçük SMTP istemcisi (bağımlılık yok): davet e-postası göndermek için. Gmail ile: Google hesabında 2 adımlı doğrulama açıkken
// "Uygulama şifresi" üret, .env'ye SMTP_USER (Gmail adresin) ve SMTP_PASS (16 haneli uygulama şifresi) yaz; gerisi varsayılan.
// Ayarlar: SMTP_HOST (smtp.gmail.com), SMTP_PORT (465, doğrudan TLS), MAIL_FROM_NAME (EV Co-Pilot). Yapılandırılmamışsa createMailer null döner.
// Yalnızca test için: SMTP_HOST 127.0.0.1/localhost ise TLS'siz bağlanılır (şifre yerel makineden çıkmaz).
import tls from 'node:tls';
import net from 'node:net';
import { randomBytes } from 'node:crypto';

const MAIL = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
export const validEmail = (s) => typeof s === 'string' && s.length <= 120 && MAIL.test(s);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`); // başlıkta ASCII dışı karakter

export function createMailer(env) {
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '').replace(/\s+/g, ''); // Google uygulama şifresi boşluklu gösterilir
  if (!user || !pass) return null;
  const host = String(env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(env.SMTP_PORT || 465);
  const fromName = String(env.MAIL_FROM_NAME || 'EV Co-Pilot').replace(/[\r\n"<>]/g, '');
  const local = host === '127.0.0.1' || host === 'localhost';

  function send({ to, subject, text }) {
    if (!validEmail(to)) return Promise.reject(new Error('geçersiz alıcı'));
    return new Promise((resolve, reject) => {
      const sock = local ? net.connect({ host, port }) : tls.connect({ host, port, servername: host });
      let buf = '';
      let waiter = null;
      let done = false;
      const finish = (err) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(); };
      const timer = setTimeout(() => finish(new Error('SMTP zaman aşımı')), 20000);
      sock.setEncoding('utf8');
      sock.on('error', (e) => finish(new Error('SMTP bağlantı hatası: ' + e.code || e.message)));
      sock.on('close', () => finish(new Error('SMTP bağlantısı kapandı')));
      const check = () => { // son yanıt satırı "250 ..." (çok satırlı yanıtta ara satırlar "250-")
        const lines = buf.split('\r\n');
        const last = lines.length > 1 ? lines[lines.length - 2] : '';
        if (waiter && /^\d{3} /.test(last)) { const w = waiter; waiter = null; const r = buf; buf = ''; w(r); }
      };
      sock.on('data', (d) => { buf += d; check(); });
      const reply = () => new Promise((res) => { waiter = res; check(); });
      const expect = async (code) => {
        const r = await reply();
        const last = r.trim().split(/\r?\n/).at(-1) || '';
        if (!last.startsWith(code + ' ')) throw new Error('SMTP: ' + last.slice(0, 120)); // yalnızca sunucunun durum satırı (parola ya da gövde sızmaz)
        return r;
      };
      const cmd = async (line, code) => { sock.write(line + '\r\n'); return expect(code); };
      (async () => {
        await expect(220);
        await cmd('EHLO evcopilot', 250);
        await cmd('AUTH LOGIN', 334);
        await cmd(b64(user), 334);
        await cmd(b64(pass), 235);
        await cmd(`MAIL FROM:<${user}>`, 250);
        await cmd(`RCPT TO:<${to}>`, 250);
        await cmd('DATA', 354);
        const body = b64(text).replace(/(.{76})/g, '$1\r\n');
        const msg = [
          `From: ${encWord(fromName)} <${user}>`, `To: <${to}>`, `Subject: ${encWord(String(subject).replace(/[\r\n]/g, ' '))}`,
          `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomBytes(8).toString('hex')}@evcopilot>`,
          'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body, '',
        ].join('\r\n').replace(/\r\n\./g, '\r\n..');
        sock.write(msg + '\r\n.\r\n');
        await expect(250);
        sock.write('QUIT\r\n');
        finish();
      })().catch(finish);
    });
  }
  return { send, user };
}
